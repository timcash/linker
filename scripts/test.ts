import {
  createBrowserTestContext,
  destroyBrowserTestContext,
  runStaticUnitTests,
} from './test/000_setup';
import {runReadyStep} from './test/001_ready';
import {runPanelsStep} from './test/002_panels';
import {runLayoutStrategiesStep} from './test/003_layout_strategies';
import {runCameraControlsStep} from './test/004_camera_controls';
import {runInputGuardsStep} from './test/005_input_guards';
import {runExtendedMatrixStep} from './test/900_extended_matrix';
import {RUN_EXTENDED_TEST_MATRIX, type BrowserTestContext} from './test/shared';

runStaticUnitTests();

let context: BrowserTestContext | undefined;
let testError: Error | undefined;

try {
  context = await createBrowserTestContext();

  const readyResult = await runReadyStep(context);

  if (readyResult !== null) {
    await runPanelsStep(context);
    await runLayoutStrategiesStep(context);
    await runCameraControlsStep(context);
    await runInputGuardsStep(context);

    if (RUN_EXTENDED_TEST_MATRIX) {
      await runExtendedMatrixStep(context);
    }
  }

  context.addBrowserLog('test', 'Browser test passed.');
  console.log('Browser test passed.');
} catch (error) {
  testError = error instanceof Error ? error : new Error(String(error));

  if (context) {
    context.addBrowserLog('test.failure', testError.stack ?? testError.message);
  }
} finally {
  if (context) {
    await destroyBrowserTestContext(context);
  }
}

if (testError) {
  throw testError;
}
