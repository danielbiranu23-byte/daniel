import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'dev-dist/**/*', 'node_modules/**/*', 'src/**/*', 'server.ts'],
  },
  {
    files: ['firestore.rules', 'DRAFT_firestore.rules'],
    ...firebaseRulesPlugin.configs['flat/recommended'],
  },
];
