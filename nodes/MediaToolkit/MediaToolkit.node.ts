import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

type AspectRatio = '16:9' | '9:16' | '1:1';

interface ResolutionDimensions {
	width: number;
	height: number;
}

const BASE_RESOLUTIONS: Record<AspectRatio, ResolutionDimensions> = {
	'16:9': { width: 1920, height: 1080 },
	'9:16': { width: 1080, height: 1920 },
	'1:1': { width: 1080, height: 1080 },
};

const PLATFORM_HASHTAG_LIMITS: Record<string, number> = {
	tiktok: 5,
	youtube: 15,
	instagram: 30,
};

const PLATFORM_CAPTION_LIMITS: Record<string, number> = {
	tiktok: 2200,
	youtube: 5000,
	instagram: 2200,
};

function calculateResolution(aspectRatio: AspectRatio, scale: number): ResolutionDimensions {
	const base = BASE_RESOLUTIONS[aspectRatio];
	return {
		width: Math.round(base.width * scale),
		height: Math.round(base.height * scale),
	};
}

function formatHashtags(rawTags: string, platform: string): string[] {
	const limit = PLATFORM_HASHTAG_LIMITS[platform] ?? 10;
	return rawTags
		.split(/[,\s]+/)
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0)
		.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
		.map((tag) => tag.replace(/[^#\w]/g, ''))
		.slice(0, limit);
}

function trimCaption(text: string, platform: string): string {
	const limit = PLATFORM_CAPTION_LIMITS[platform] ?? 2200;
	const trimmed = text.trim();
	return trimmed.length > limit ? trimmed.slice(0, limit - 1).trimEnd() + '…' : trimmed;
}

export class MediaToolkit implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Media Toolkit',
		name: 'mediaToolkit',
		icon: 'file:mediaToolkit.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Video metadata calculations and social caption formatting',
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
						description: 'Calculate resolution, frame count, and specs from video parameters',
						action: 'Extract video metadata specs',
					},
					{
						name: 'Build Social Caption Payload',
						value: 'buildSocialCaptionPayload',
						description: 'Trim caption text and format hashtags for a target platform',
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
				displayOptions: {
					show: {
						operation: ['extractVideoMetadataSpecs'],
					},
				},
				description: 'Frames per second of the source video',
			},
			{
				displayName: 'Duration (Seconds)',
				name: 'duration',
				type: 'number',
				default: 15,
				displayOptions: {
					show: {
						operation: ['extractVideoMetadataSpecs'],
					},
				},
				description: 'Total duration of the video in seconds',
			},
			{
				displayName: 'Aspect Ratio',
				name: 'aspectRatio',
				type: 'options',
				options: [
					{ name: '16:9 (Landscape)', value: '16:9' },
					{ name: '9:16 (Portrait)', value: '9:16' },
					{ name: '1:1 (Square)', value: '1:1' },
				],
				default: '16:9',
				displayOptions: {
					show: {
						operation: ['extractVideoMetadataSpecs'],
					},
				},
				description: 'Target aspect ratio for output resolution calculation',
			},
			{
				displayName: 'Resolution Scale',
				name: 'resolutionScale',
				type: 'number',
				default: 1,
				typeOptions: {
					minValue: 0.1,
					maxValue: 4,
					numberStepSize: 0.1,
				},
				displayOptions: {
					show: {
						operation: ['extractVideoMetadataSpecs'],
					},
				},
				description: 'Multiplier applied to the base resolution for the chosen aspect ratio (1 = standard HD base)',
			},

			// ---------- Build Social Caption Payload ----------
			{
				displayName: 'Caption Text',
				name: 'captionText',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				displayOptions: {
					show: {
						operation: ['buildSocialCaptionPayload'],
					},
				},
				description: 'Raw caption text to trim and package',
			},
			{
				displayName: 'Hashtags',
				name: 'hashtags',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['buildSocialCaptionPayload'],
					},
				},
				description: 'Comma or space separated hashtags, with or without leading #',
			},
			{
				displayName: 'Platform',
				name: 'platform',
				type: 'options',
				options: [
					{ name: 'TikTok', value: 'tiktok' },
					{ name: 'YouTube', value: 'youtube' },
					{ name: 'Instagram', value: 'instagram' },
				],
				default: 'tiktok',
				displayOptions: {
					show: {
						operation: ['buildSocialCaptionPayload'],
					},
				},
				description: 'Target platform, used to apply caption length limits and hashtag count limits',
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

					const resolution = calculateResolution(aspectRatio, resolutionScale);
					const totalFrames = Math.round(frameRate * duration);

					returnData.push({
						json: {
							frameRate,
							duration,
							aspectRatio,
							resolutionScale,
							totalFrames,
							outputWidth: resolution.width,
							outputHeight: resolution.height,
						},
						pairedItem: { item: i },
					});
				} else if (operation === 'buildSocialCaptionPayload') {
					const captionText = this.getNodeParameter('captionText', i) as string;
					const hashtags = this.getNodeParameter('hashtags', i) as string;
					const platform = this.getNodeParameter('platform', i) as string;

					const trimmedCaption = trimCaption(captionText, platform);
					const formattedHashtags = formatHashtags(hashtags, platform);
					const fullCaption = [trimmedCaption, formattedHashtags.join(' ')]
						.filter((part) => part.length > 0)
						.join('\n\n');

					returnData.push({
						json: {
							platform,
							caption: trimmedCaption,
							hashtags: formattedHashtags,
							fullCaption,
							characterCount: fullCaption.length,
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
