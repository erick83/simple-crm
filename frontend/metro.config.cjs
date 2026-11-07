const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const defaultBlockList = Array.isArray(config.resolver.blockList)
  ? config.resolver.blockList
  : [config.resolver.blockList].filter(Boolean);

// Evitar que el file watcher de Metro observe los artefactos temporales de compilación de Cargo/Rust
config.resolver.blockList = [
  ...defaultBlockList,
  /.*[/\\]src-tauri[/\\]target[/\\].*/,
];

module.exports = config;
