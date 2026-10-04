/** PNG previews imported by the bundled LING renderer become data URLs. */
declare module '*.png' {
  const url: string
  export default url
}
