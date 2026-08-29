import deckyPlugin from "@decky/rollup";
import sucrase from "@rollup/plugin-sucrase";

export default deckyPlugin({
  // @decky/rollup 1.0.2 bundles plugin-typescript 11.1.6, which can return
  // the original TSX entry unchanged for the Ask AI source graph. Type checks
  // run separately; Sucrase ensures Rollup always receives JavaScript here.
  plugins: [sucrase({ transforms: ["typescript", "jsx"] })],
});
