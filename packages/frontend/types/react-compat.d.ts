// React 19 compatibility declarations for third-party packages
declare module '*.d.ts' {
  export = any;
}

// Global React namespace augmentation for compatibility
declare global {
  namespace React {
    type FC<P = {}> = FunctionComponent<P>;
    type ReactText = string | number;
    type ReactChild = ReactElement | ReactText;
    type ReactNode = ReactChild | ReactChild[] | boolean | null | undefined;
  }
}

export {};
