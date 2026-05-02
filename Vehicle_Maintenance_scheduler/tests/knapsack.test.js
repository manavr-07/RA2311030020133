const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAuthHeaderValue,
  buildApiUrl,
  optimizeTasks
} = require("../vehicle_maintenance_scheduler/scheduler");

test("selects the task subset with the maximum impact under capacity", () => {
  const tasks = [
    { TaskID: "T1", Duration: 2, Impact: 6 },
    { TaskID: "T2", Duration: 4, Impact: 9 },
    { TaskID: "T3", Duration: 3, Impact: 8 },
    { TaskID: "T4", Duration: 1, Impact: 3 }
  ];

  const result = optimizeTasks(tasks, 5);

  assert.equal(result.totalImpact, 14);
  assert.deepEqual(
    result.selectedTasks.map((task) => task.TaskID),
    ["T1", "T3"]
  );
});

test("returns an empty schedule when no tasks fit", () => {
  const tasks = [{ TaskID: "T1", Duration: 10, Impact: 100 }];
  const result = optimizeTasks(tasks, 2);

  assert.equal(result.totalImpact, 0);
  assert.deepEqual(result.selectedTasks, []);
});

test("rejects invalid hour capacity", () => {
  assert.throws(() => optimizeTasks([], -1), /non-negative integer/);
});

test("builds API URLs without dropping the service path", () => {
  const url = buildApiUrl(
    "depots",
    "http://20.207.122.201/evaluation-service"
  );

  assert.equal(
    url.href,
    "http://20.207.122.201/evaluation-service/depots"
  );
});

test("adds Bearer prefix for raw authorization tokens", () => {
  assert.equal(
    buildAuthHeaderValue("abc.def.ghi", "Authorization"),
    "Bearer abc.def.ghi"
  );
});
