import { MediaToolkit } from './MediaToolkit.node';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

function mockExecute(
	operation: string,
	params: Record<string, unknown>,
	items: INodeExecutionData[] = [{ json: {} }],
): IExecuteFunctions {
	return {
		getInputData: () => items,
		getNodeParameter: (name: string) => {
			if (name === 'operation') return operation;
			return params[name];
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
	});
});
