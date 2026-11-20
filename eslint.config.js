// Code check (npm run lint): finds names used but never defined, imports that do not
// exist, and leftovers nobody uses. It catches the mistakes the tests cannot see.
const browser = Object.fromEntries([
  'window', 'document', 'navigator', 'localStorage', 'location', 'history', 'performance',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'console', 'ResizeObserver', 'Path2D', 'File', 'URL', 'Blob'
].map(n => [n, 'readonly']));

export default [
  {
    files: ['public/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...browser, process: 'readonly' } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error'
    }
  }
];
