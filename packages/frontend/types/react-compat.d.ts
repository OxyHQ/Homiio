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

// React compatibility types to resolve conflicts
declare module 'react' {
  interface ReactNode {
    children?: ReactNode;
  }
}

// Ensure Text component accepts style prop
declare module 'react-native' {
  interface TextProps {
    style?: any;
    children?: React.ReactNode;
  }
}

export {};
