export default {
  displayName: 'plugin-schedule',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  // class-validator/class-transformer decorators need the metadata reflection
  // shim that Nest loads at bootstrap; jest specs run without that entrypoint.
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/plugin-schedule',
};
