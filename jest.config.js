/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/nodes'],
	testMatch: ['**/*.test.ts'],
	collectCoverageFrom: ['nodes/**/*.ts', '!nodes/**/*.test.ts'],
};
