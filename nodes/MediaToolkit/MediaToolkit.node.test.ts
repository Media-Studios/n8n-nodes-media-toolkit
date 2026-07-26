import { MediaToolkit } from './MediaToolkit.node';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

function mockExecute(
	operation: string,
	params: Record<string, unknown>,
	items: INodeExecutionData[] = [{ json: {} }],
): IExecuteFunctions {
	return {
		getInputData: () => items,
		getNodeParameter: (name: string, _itemIndex?: number, fallback?: unknown) => {
			if (name === 'operation') return operation;
			return name in params ? params[name] : fallback;
		},
		continueOnFail: () => false,
	} as unknown as IExecuteFunctions;
}

describe('MediaToolkit › Extract Video Metadata Specs', () => {
	it('calculates total frames and 9:16 resolution at scale 1', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('extractVideoMetadataSpecs', {
			frameRate: 30,
			duration: 15,
			aspectRatio: '9:16',
			resolutionScale: 1,
		});

		const [output] = await node.execute.call(ctx);

		expect(output[0].json).toMatchObject({
			totalFrames: 450,
			outputWidth: 1080,
			outputHeight: 1920,
			resolutionLabel: '1080p',
		});
	});

	it('applies the resolution scale multiplier to 16:9', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('extractVideoMetadataSpecs', {
			frameRate: 24,
			duration: 10,
			aspectRatio: '16:9',
			resolutionScale: 0.5,
		});

		const [output] = await node.execute.call(ctx);

		expect(output[0].json).toMatchObject({
			totalFrames: 240,
			outputWidth: 960,
			outputHeight: 540,
		});
	});

	it('rounds dimensions to even values (encoder-safe)', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('extractVideoMetadataSpecs', {
			frameRate: 30,
			duration: 5,
			aspectRatio: '4:5',
			resolutionScale: 0.7,
		});

		const [output] = await node.execute.call(ctx);
		expect((output[0].json.outputWidth as number) % 2).toBe(0);
		expect((output[0].json.outputHeight as number) % 2).toBe(0);
	});

	it('derives a recommended bitrate and ffmpeg args when no target bitrate is given', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('extractVideoMetadataSpecs', {
			frameRate: 30,
			duration: 15,
			aspectRatio: '9:16',
			resolutionScale: 1,
		});

		const [output] = await node.execute.call(ctx);
		const json = output[0].json;

		// 0.1 * 1080 * 1920 * 30 / 1e6 = 6.2208 -> 6.22
		expect(json.recommendedBitrateMbps).toBeCloseTo(6.22, 2);
		expect(json.bitrateMbps).toBe(json.recommendedBitrateMbps);
		expect(json.ffmpegScaleFilter).toBe('scale=1080:1920');
		expect(json.ffmpegArgs).toBe('-r 30 -s 1080x1920 -t 15 -b:v 6.22M');
		// filesize = 6.22 * 15 / 8 = 11.6625 -> 11.66
		expect(json.estimatedFileSizeMB).toBeCloseTo(11.66, 2);
	});

	it('honours an explicit target bitrate for the file-size estimate', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('extractVideoMetadataSpecs', {
			frameRate: 30,
			duration: 20,
			aspectRatio: '16:9',
			resolutionScale: 1,
			targetBitrate: 8,
		});

		const [output] = await node.execute.call(ctx);
		expect(output[0].json.bitrateMbps).toBe(8);
		// 8 * 20 / 8 = 20 MB
		expect(output[0].json.estimatedFileSizeMB).toBe(20);
	});
});

describe('MediaToolkit › Build Social Caption Payload', () => {
	it('normalizes hashtags and respects the TikTok 5-tag limit', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('buildSocialCaptionPayload', {
			captionText: '  Hello world  ',
			hashtags: 'one, two three #four five six seven',
			platform: 'tiktok',
		});

		const [output] = await node.execute.call(ctx);

		expect(output[0].json.caption).toBe('Hello world');
		expect(output[0].json.hashtags).toEqual(['#one', '#two', '#three', '#four', '#five']);
		expect(output[0].json.droppedHashtagCount).toBe(2);
	});

	it('de-duplicates hashtags case-insensitively', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('buildSocialCaptionPayload', {
			captionText: 'hi',
			hashtags: '#Travel #travel #TRAVEL #food',
			platform: 'instagram',
		});

		const [output] = await node.execute.call(ctx);
		expect(output[0].json.hashtags).toEqual(['#Travel', '#food']);
	});

	it('lowercases hashtags when the option is set', async () => {
		const node = new MediaToolkit();
		const ctx = mockExecute('buildSocialCaptionPayload', {
			captionText: 'hi',
			hashtags: '#Travel #Food',
			platform: 'instagram',
			lowercaseHashtags: true,
		});

		const [output] = await node.execute.call(ctx);
		expect(output[0].json.hashtags).toEqual(['#travel', '#food']);
	});

	it('trims caption text to the platform limit', async () => {
		const node = new MediaToolkit();
		const longText = 'a'.repeat(2500);
		const ctx = mockExecute('buildSocialCaptionPayload', {
			captionText: longText,
			hashtags: '',
			platform: 'instagram',
		});

		const [output] = await node.execute.call(ctx);

		expect((output[0].json.caption as string).length).toBeLessThanOrEqual(2200);
		expect(output[0].json.caption).toMatch(/…$/);
		expect(output[0].json.truncated).toBe(true);
	});

	it('keeps the full payload within the platform budget after reserving hashtag space', async () => {
		const node = new MediaToolkit();
		const longText = 'b'.repeat(2500);
		const ctx = mockExecute('buildSocialCaptionPayload', {
			captionText: longText,
			hashtags: '#alpha #beta #gamma',
			platform: 'tiktok',
		});

		const [output] = await node.execute.call(ctx);
		const json = output[0].json;
		expect(json.characterCount as number).toBeLessThanOrEqual(json.platformCharacterLimit as number);
		expect(json.withinLimit).toBe(true);
		expect(json.hashtagBlock).toBe('#alpha #beta #gamma');
	});

	it('sanitizes control/zero-width characters and collapses blank lines', async () => {
		const node = new MediaToolkit();
		const zwsp = String.fromCharCode(0x200b);
		const ctx = mockExecute('buildSocialCaptionPayload', {
			captionText: `line one ${zwsp}\n\n\n\nline two   `,
			hashtags: '',
			platform: 'youtube',
		});

		const [output] = await node.execute.call(ctx);
		expect(output[0].json.caption).toBe('line one\n\nline two');
	});
});
