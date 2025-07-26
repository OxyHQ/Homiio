export const phuduFontWeights = {
  thin: 'Phudu-Thin',
  regular: 'Phudu-Regular',
  medium: 'Phudu-Medium',
  semiBold: 'Phudu-SemiBold',
  bold: 'Phudu-Bold',
} as const;

export const getFontWeight = (weight: keyof typeof phuduFontWeights) => {
  return phuduFontWeights[weight];
}; 