declare module '*.css';

// Static image assets resolved by Metro's asset registry. Importing a PNG/JPG
// yields the RN image source (an opaque asset id at runtime); typing the
// default export keeps consumers (expo-image / RN Image `source`) fully typed
// without relying on an implicit `any`.
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const content: ImageSourcePropType;
  export default content;
}

declare module '*.jpg' {
  import type { ImageSourcePropType } from 'react-native';
  const content: ImageSourcePropType;
  export default content;
}
