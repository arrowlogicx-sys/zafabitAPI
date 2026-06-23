const fs = require('fs');
const path = require('path');
const { assertSafePerformanceDatabase, getDatabaseName } = require('../../performance/config');
const { assessLoad } = require('../../performance/generatePerformanceReport');

describe('admin performance harness safety', () => {
  const previousAllowSeed = process.env.PERF_ALLOW_SEED;

  afterEach(() => {
    if (previousAllowSeed === undefined) delete process.env.PERF_ALLOW_SEED;
    else process.env.PERF_ALLOW_SEED = previousAllowSeed;
  });

  it('extracts the target database name from MongoDB URIs', () => {
    expect(getDatabaseName('mongodb://localhost:27017/zaffabit_performance?retryWrites=true')).toBe(
      'zaffabit_performance',
    );
  });

  it('refuses production-like database names even when seeding is enabled', () => {
    process.env.PERF_ALLOW_SEED = 'true';
    expect(() =>
      assertSafePerformanceDatabase('mongodb://localhost:27017/zaffabit', 'seed'),
    ).toThrow(/Refusing/);
  });

  it('requires explicit seeding permission for a performance database', () => {
    delete process.env.PERF_ALLOW_SEED;
    expect(() =>
      assertSafePerformanceDatabase('mongodb://localhost:27017/zaffabit_performance', 'seed'),
    ).toThrow(/PERF_ALLOW_SEED/);
  });

  it('accepts a dedicated performance database with explicit permission', () => {
    process.env.PERF_ALLOW_SEED = 'true';
    expect(
      assertSafePerformanceDatabase('mongodb://localhost:27017/zaffabit_performance', 'seed'),
    ).toBe('zaffabit_performance');
  });

  it('marks missing full-load evidence as not passed', () => {
    expect(assessLoad(null)).toMatchObject({ executed: false, passed: false });
  });

  it('ships all three Artillery stages', () => {
    for (const file of ['artillery.smoke.yml', 'artillery.full.yml', 'artillery.recovery.yml']) {
      expect(fs.existsSync(path.resolve(__dirname, '../../performance', file))).toBe(true);
    }
  });
});
