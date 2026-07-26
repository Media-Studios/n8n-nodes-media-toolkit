import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

interface ResolutionDimensions {
	width: number;
	height: number;
}

const BASE_RESOLUTIONS: Record<AspectRatio, ResolutionDimensions> = {
	'16:9': { width: 1920, height: 1080 },
	'9:16': { width: 1080, height: 1920 },
	'1:1': { width: 1080, height: 1080 },
	'4:5': { width: 1080, height: 1350 },
};

// Recommended max hashtag counts per platform (TikTok kept intentionally lean).
const PLATFORM_HASHTAG_LIMITS: Record<string, number> = {
	tiktok: 5,
	youtube: 15,
	shorts: 15,
	reels: 30,
	instagram: 30,
};

// Caption character ceilings per platform.
const PLATFORM_CAPTION_LIMITS: Record<string, number> = {
	tiktok: 2200,
	youtube: 5000,
	shorts: 5000,
	reels: 2200,
	instagram: 2200,
};

// Bits-per-pixel-per-frame constant used for the H.264 bitrate heuristic.
const H264_BITS_PER_PIXEL = 0.1;

/** Round to the nearest even integer — H.264/H.265 encoders reject odd dimensions. */
function roundEven(value: number): number {
	return 2 * Math.round(value / 2);
}

function calculateResolution(aspectRatio: AspectRatio, scale: number): ResolutionDimensions {
	const base = BASE_RESOLUTIONS[aspectRatio];
	return {
		width: roundEven(base.width * scale),
		height: roundEven(base.height * scale),
	};
}

/** Heuristic recommended H.264 video bitrate (Mbps) for a resolution + frame rate. */
function recommendedBitrateMbps(width: number, height: number, fps: number): number {
	const bitsPerSecond = H264_BITS_PER_PIXEL * width * height * fps;
	const mbps = bitsPerSecond / 1_000_000;
	return Math.max(1, Math.round(mbps * 100) / 100);
}

/** Drop control + zero-width characters, trailing spaces, and excess blank lines. */
function sanitizeText(text: string): string {
	const stripped = Array.from(text.replace(/\r\n?/g, '\n'))
		.filter((ch) => {
			if (ch === '\n' || ch === '\t') return true;
			const code = ch.codePointAt(0) as number;
			if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return false; // C0/C1 control
			if (code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff) {
				return false; // zero-width space/joiner/BOM
			}
			return true;
		})
		.join('');
	return stripped
		.split('\n')
		.map((line) => line.replace(/[ \t]+$/g, ''))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

interface HashtagResult {
	hashtags: string[];
	dropped: number;
}

function formatHashtags(rawTags: string, platform: string, lowercase: boolean): HashtagResult {
	const limit = PLATFORM_HASHTAG_LIMITS[platform] ?? 10;

	const normalized = rawTags
		.split(/[,\s]+/)
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)
		.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
		.map((tag) => tag.replace(/[^#\w]/g, ''))
		.filter((tag) => tag.length > 1)
		.map((tag) => (lowercase ? tag.toLowerCase() : tag));

	// De-duplicate case-insensitively, preserving first-seen order.
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const tag of normalized) {
		const key = tag.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(tag);
		}
	}

	const hashtags = unique.slice(0, limit);
	return { hashtags, dropped: normalized.length - hashtags.length };
}

interface FitResult {
	text: string;
	truncated: boolean;
}

/** Trim text to a hard character limit, appending an ellipsis when cut. */
function fitCaption(text: string, limit: number): FitResult {
	if (limit <= 0) return { text: '', truncated: text.length > 0 };
	if (text.length <= limit) return { text, truncated: false };
	return { text: text.slice(0, limit - 1).trimEnd() + '…', truncated: true };
}

export class MediaToolkit implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Media Toolkit',
		name: 'mediaToolkit',
		icon: 'file:mediaToolkit.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Video spec calculations and social caption formatting for media workflows',
		defaults: {
			name: 'Media Toolkit',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Extract Video Metadata Specs',
						value: 'extractVideoMetadataSpecs',
						description:
							'Compute output resolution, frame count, bitrate, file-size estimate and ffmpeg render args',
						action: 'Extract video metadata specs',
					},
					{
						name: 'Build Social Caption Payload',
						value: 'buildSocialCaptionPayload',
						description: 'Sanitize a caption and format hashtags within a platform character budget',
						action: 'Build social caption payload',
					},
				],
				default: 'extractVideoMetadataSpecs',
			},

			// ---------- Extract Video Metadata Specs ----------
			{
				displayName: 'Frame Rate (FPS)',
				name: 'frameRate',
				type: 'number',
				default: 30,
				displayOptions: { show: { operation: ['extractVideoMetadataSpecs'] } },
				description: 'Frames per second of the output video',
			},
			{
				displayName: 'Duration (Seconds)',
				name: 'duration',
				type: 'number',
				default: 15,
				displayOptions: { show: { operation: ['extractVideoMetadataSpecs'] } },
				description: 'Total duration of the video in seconds',
			},
			{
				displayName: 'Aspect Ratio',
				name: 'aspectRatio',
				type: 'options',
				options: [
					{ name: '16:9 (Landscape)', value: '16:9' },
					{ name: '9:16 (Vertical / Shorts)', value: '9:16' },
					{ name: '1:1 (Square)', value: '1:1' },
					{ name: '4:5 (Portrait Feed)', value: '4:5' },
				],
				default: '9:16',
				displayOptions: { show: { operation: ['extractVideoMetadataSpecs'] } },
				description: 'Target aspect ratio for the output resolution',
			},
			{
				displayName: 'Resolution Scale',
				name: 'resolutionScale',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 0.1, maxValue: 4, numberStepSize: 0.1 },
				displayOptions: { show: { operation: ['extractVideoMetadataSpecs'] } },
				description:
					'Multiplier applied to the base resolution for the chosen aspect ratio (1 = 1080-class base)',
			},
			{
				displayName: 'Target Bitrate (Mbps)',
				name: 'targetBitrate',
				type: 'number',
				default: 0,
				typeOptions: { minValue: 0, numberStepSize: 0.5 },
				displayOptions: { show: { operation: ['extractVideoMetadataSpecs'] } },
				description:
					'Video bitrate in Mbps used for the file-size estimate. Leave at 0 to auto-derive a recommended H.264 bitrate.',
			},

			// ---------- Build Social Caption Payload ----------
			{
				displayName: 'Caption Text',
				name: 'captionText',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				displayOptions: { show: { operation: ['buildSocialCaptionPayload'] } },
				description: 'Raw caption text to sanitize and package',
			},
			{
				displayName: 'Hashtags',
				name: 'hashtags',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['buildSocialCaptionPayload'] } },
				description: 'Comma or space separated hashtags, with or without a leading #',
			},
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'options',
				options: [
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'YouTube (Shorts)', value: 'youtube' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'Instagram Reels', value: 'reels' },
				],
				default: 'tiktok',
				displayOptions: { show: { operation: ['buildSocialCaptionPayload'] } },
				description: 'Target platform — sets the caption character budget and hashtag count limit',
			},
			{
				displayName: 'Lowercase Hashtags',
				name: 'lowercaseHashtags',
				type: 'boolean',
				default: false,
				displayOptions: { show: { operation: ['buildSocialCaptionPayload'] } },
				description: 'Whether to force all hashtags to lowercase',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'extractVideoMetadataSpecs') {
					const frameRate = this.getNodeParameter('frameRate', i) as number;
					const duration = this.getNodeParameter('duration', i) as number;
					const aspectRatio = this.getNodeParameter('aspectRatio', i) as AspectRatio;
					const resolutionScale = this.getNodeParameter('resolutionScale', i) as number;
					const targetBitrate = (this.getNodeParameter('targetBitrate', i, 0) as number) || 0;

					const { width, height } = calculateResolution(aspectRatio, resolutionScale);
					const totalFrames = Math.round(frameRate * duration);
					const recommended = recommendedBitrateMbps(width, height, frameRate);
					const bitrateMbps = targetBitrate > 0 ? targetBitrate : recommended;
					const estimatedFileSizeMB = Math.round(((bitrateMbps * duration) / 8) * 100) / 100;
					const megapixels = Math.round((width * height) / 10_000) / 100;

					returnData.push({
						json: {
							frameRate,
							duration,
							aspectRatio,
							resolutionScale,
							totalFrames,
							outputWidth: width,
							outputHeight: height,
							resolutionLabel: `${Math.min(width, height)}p`,
							aspectRatioDecimal: Math.round((width / height) * 10_000) / 10_000,
							megapixels,
							recommendedBitrateMbps: recommended,
							bitrateMbps,
							estimatedFileSizeMB,
							ffmpegScaleFilter: `scale=${width}:${height}`,
							ffmpegArgs: `-r ${frameRate} -s ${width}x${height} -t ${duration} -b:v ${bitrateMbps}M`,
							renderParams: {
								width,
								height,
								fps: frameRate,
								durationSeconds: duration,
								totalFrames,
								bitrateMbps,
							},
						},
						pairedItem: { item: i },
					});
				} else if (operation === 'buildSocialCaptionPayload') {
					const captionText = this.getNodeParameter('captionText', i) as string;
					const rawHashtags = this.getNodeParameter('hashtags', i) as string;
					const platform = this.getNodeParameter('platform', i) as string;
					const lowercase =
						(this.getNodeParameter('lowercaseHashtags', i, false) as boolean) ?? false;

					const captionLimit = PLATFORM_CAPTION_LIMITS[platform] ?? 2200;
					const { hashtags, dropped } = formatHashtags(rawHashtags, platform, lowercase);
					const hashtagBlock = hashtags.join(' ');

					// Reserve room for the hashtag block (plus the blank-line separator) so the
					// combined payload stays within the platform's character budget.
					const reserved = hashtagBlock.length > 0 ? hashtagBlock.length + 2 : 0;
					const sanitized = sanitizeText(captionText);
					const { text: caption, truncated } = fitCaption(sanitized, captionLimit - reserved);

					const fullCaption = [caption, hashtagBlock]
						.filter((part) => part.length > 0)
						.join('\n\n');

					returnData.push({
						json: {
							platform,
							caption,
							hashtags,
							hashtagBlock,
							fullCaption,
							characterCount: fullCaption.length,
							platformCharacterLimit: captionLimit,
							hashtagLimit: PLATFORM_HASHTAG_LIMITS[platform] ?? 10,
							withinLimit: fullCaption.length <= captionLimit,
							truncated,
							droppedHashtagCount: dropped,
						},
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
