/**
 * React Native's `FormData.append` accepts a `{ uri, name, type }` file
 * descriptor for multipart uploads in addition to the standard `string | Blob`
 * values declared by the DOM lib. This augmentation teaches TypeScript about
 * that runtime-supported shape so image/file uploads stay fully typed without
 * casts.
 */
interface ReactNativeFormDataValue {
  uri: string;
  name?: string;
  type?: string;
}

interface FormData {
  append(name: string, value: ReactNativeFormDataValue): void;
  set(name: string, value: ReactNativeFormDataValue): void;
}
