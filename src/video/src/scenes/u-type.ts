import { proof } from "./_proof";

export default proof({
  path: "src/interface/span.zig",
  hot: 1,
  page: "1 / 6",
  lines: [
    `pub fn write(self: @This(), offset: usize, chunk: []const u8) void {`,
    `    if (View == []const u8) @compileError("a const span cannot be written.");`,
    `    @memcpy(self.sub(offset, chunk.len).bytes(), chunk);`,
    `}`,
  ],
  claim: [
    `write(const) -> compile_error`,
    `no program writes through a const span`,
  ],
  grep: `@compileError`,
  hits: [
    `src/kernel/discovery.zig:34:    const component = findByName(component_name) orelse @compileError("unknown component \\"" ++ component_name ++ "\\": no descriptor declares this name.");`,
    `src/kernel/discovery.zig:38:    @compileError("unknown parameter \\"" ++ parameter_name ++ "\\" for component \\"" ++ component_name ++ "\\".");`,
    `src/kernel/render.zig:46:        const index = std.mem.find(u8, output, replacement.marker) orelse @compileError("header template marker is missing.");`,
    `src/kernel/render.zig:47:        if (std.mem.findPos(u8, output, index + replacement.marker.len, replacement.marker) != null) @compileError("header template marker must be unique.");`,
    `src/kernel/render.zig:50:    if (std.mem.find(u8, output, "@STDK_") != null) @compileError("template has an unresolved standard-kit marker.");`,
  ],
  answer: "25",
  unit: "sites",
});
