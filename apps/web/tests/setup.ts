import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import '@/i18n';

configure({ asyncUtilTimeout: 5000 });
expect.extend(matchers);

afterEach(() => {
  cleanup();
});
