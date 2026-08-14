// Runs before any test file is loaded (see jest.config.js setupFiles).
// The mock payment gateway randomly fails ~5% of calls by default, which
// would make integration tests flaky. Force it to always succeed so the
// happy-path lifecycle tests are deterministic; unit tests mock the
// gateway module directly and are unaffected by this.
process.env.MOCK_GATEWAY_SUCCESS_RATE = '1';
