// Compatibility import path for panel code. The implementation lives in Core
// because the CLI is now its second consumer.
export { patchEnvFile, updateEnvFile, isWritable, parseEnv, readEnvFile, setEnvValue, writeEnvFile } from 'portta-core'
