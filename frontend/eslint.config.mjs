import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    files: ['app/domain/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/application/**', '**/infrastructure/**', '**/presentation/**', '**/components/**', '**/pages/**', '**/layouts/**', '**/plugins/**'],
          message: 'Domain must not depend on outer frontend layers.',
        }],
      }],
    },
  },
  {
    files: ['app/application/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/infrastructure/**', '**/presentation/**', '**/components/**', '**/pages/**', '**/layouts/**', '**/plugins/**'],
          message: 'Application may depend only on domain and application contracts.',
        }],
      }],
    },
  },
  {
    files: [
      'app/components/**/*.{ts,vue}',
      'app/pages/**/*.{ts,vue}',
      'app/layouts/**/*.{ts,vue}',
      'app/presentation/**/*.{ts,vue}',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/infrastructure/**'],
          message: 'Presentation must receive adapters through the Nuxt composition root.',
        }],
      }],
      'no-restricted-globals': ['error',
        { name: 'localStorage', message: 'Use an application port and browser adapter.' },
        { name: 'navigator', message: 'Use an application port and browser adapter.' },
        { name: 'crypto', message: 'Use an application port and browser adapter.' },
      ],
    },
  },
)
