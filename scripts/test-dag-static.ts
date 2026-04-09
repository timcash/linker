import {appendLogEvent, initializeUnifiedLog} from './logging';
import {runStaticUnitTests} from './test/unit';

await initializeUnifiedLog({
  append: process.env.LINKER_APPEND_TEST_LOG === '1',
  cwd: process.cwd(),
  sessionLabel: 'Starting static DAG tests.',
});

try {
  runStaticUnitTests();
  await appendLogEvent('test.static.pass', 'Static DAG tests passed.');
  console.log('Static DAG tests passed.');
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await appendLogEvent('test.static.failure', message);
  throw error;
}
