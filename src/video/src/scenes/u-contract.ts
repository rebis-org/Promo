import { proof } from "./_proof";

export default proof({
  path: "src/interface/span.zig",
  hot: 1,
  page: "4 / 6",
  lines: [
    `pub fn checkRange(total: usize, offset: usize, length: usize) void {`,
    `    if (offset > total or length > total - offset) trap(.out_of_bounds, "subspan is out of bounds.");`,
    `}`,
    ``,
    `pub fn hasOverlap(first_start: usize, first_len: usize, second_start: usize, second_len: usize) bool {`,
    `    if (first_len == 0 or second_len == 0) return false;`,
    `    // A wrapped u64 end reads as disjoint under subtraction, so the copy`,
    `    // traps instead of reading past it.`,
    `    return second_start < first_start +| first_len and first_start < second_start +| second_len;`,
    `}`,
  ],
  claim: [`for v in Violation:  raise(v) -> no return`],
  grep: `trap(`,
  hits: [
    `src/interface/block.zig:51:        if (current != self.generation) span.trap(.use_after_free, "tracked span is stale: the block was freed or reused.");`,
    `src/interface/span.zig:15:pub fn trap(violation: Violation, context: []const u8) noreturn {`,
    `src/interface/span.zig:25:    @trap();`,
    `src/interface/span.zig:29:    if (offset > total or length > total - offset) trap(.out_of_bounds, "subspan is out of bounds.");`,
    `src/interface/span.zig:89:    if (hasOverlap(@intFromPtr(first.ptr), first.len, @intFromPtr(second.ptr), second.len)) trap(.overlap, context);`,
  ],
  answer: "7",
  unit: "trap sites",
});
