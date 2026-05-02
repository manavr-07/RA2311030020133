const { createOptimizedSchedule, ExternalApiError } = require("./scheduler");

function parseHoursArg(argv) {
  const hoursArg = argv.find((arg) => arg.startsWith("--hours="));
  const rawHours = hoursArg ? hoursArg.split("=")[1] : argv[0];

  if (!rawHours) {
    return { error: "Usage: npm run schedule -- --hours=8" };
  }

  const hours = Number(rawHours);

  if (!Number.isInteger(hours) || hours < 0) {
    return { error: "hours must be a non-negative integer" };
  }

  return { hours };
}

function printSchedule(schedule) {
  console.log(`Successfully optimized ${schedule.selectedTasks.length} maintenance tasks.`);
  console.log("");
  console.log("VEHICLE MAINTENANCE SCHEDULE");
  console.log("==================================================");
  console.log(`Max Hours:     ${schedule.maxHours}`);
  console.log(`Total Impact:  ${schedule.totalImpact}`);
  console.log("--------------------------------------------------");

  if (schedule.selectedTasks.length === 0) {
    console.log("No maintenance tasks can be scheduled within the available hours.");
    console.log("==================================================");
    return;
  }

  schedule.selectedTasks.forEach((task, index) => {
    console.log(`#${index + 1} | Task ID: ${task.TaskID}`);
    console.log(`    Duration: ${task.Duration} hour(s)`);
    console.log(`    Impact:   ${task.Impact}`);
    console.log("--------------------------------------------------");
  });

  console.log("Take a screenshot of this terminal output for submission.");
}

async function main() {
  const parsed = parseHoursArg(process.argv.slice(2));

  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  try {
    const schedule = await createOptimizedSchedule(parsed.hours);
    printSchedule(schedule);
  } catch (error) {
    if (error instanceof ExternalApiError) {
      console.error(`Failed to fetch scheduling data: ${error.message}`);
      if (error.failures) {
        error.failures.forEach((failure) => {
          console.error(`- ${failure.endpoint || "unknown endpoint"}: ${failure.message}`);
        });
      }
      process.exit(1);
    }

    console.error(`Failed to generate schedule: ${error.message}`);
    process.exit(1);
  }
}

main();
