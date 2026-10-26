import { proof } from "./_proof";

export default proof({
  path: "src/common/primitive/exception.zig",
  hot: 2,
  page: "3 / 6",
  lines: [
    `pub fn fromStd(err: anyerror) Exception {`,
    `    return switch (err) {`,
    `        error.OutOfMemory, error.WriteFailed => error.CapacityException,`,
    `        else => error.DataException,`,
    `    };`,
    `}`,
  ],
  claim: [`failure(e) -> e in return type`, `trap not in failures`],
  grep: `Exception,$`,
  hits: [
    `src/common/primitive/exception.zig:3:    CallException,`,
    `src/common/primitive/exception.zig:4:    UnsupportedException,`,
    `src/common/primitive/exception.zig:5:    CapacityException,`,
    `src/common/primitive/exception.zig:6:    DataException,`,
    `src/common/primitive/exception.zig:7:    IntegrityException,`,
  ],
  answer: "8",
  unit: "exceptions",
});
