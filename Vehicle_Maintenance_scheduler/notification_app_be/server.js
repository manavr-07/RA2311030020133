const http = require("http");
const logger = require("../logging_middleware/logger");
const {
  ExternalApiError,
  createOptimizedSchedule,
  getConfig
} = require("../vehicle_maintenance_scheduler/scheduler");

const config = getConfig();
const middlewares = [logger];

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

function runMiddlewares(req, res, middlewaresToRun, done) {
  let index = 0;

  function next(error) {
    if (error) {
      sendJson(res, 500, { error: "Internal middleware error" });
      return;
    }

    const middleware = middlewaresToRun[index];
    index += 1;

    if (!middleware) {
      done();
      return;
    }

    middleware(req, res, next);
  }

  next();
}

function parseHours(url) {
  const rawHours = url.searchParams.get("hours");

  if (rawHours === null || rawHours.trim() === "") {
    return { error: "Query parameter 'hours' is required" };
  }

  const hours = Number(rawHours);

  if (!Number.isInteger(hours) || hours < 0) {
    return { error: "Query parameter 'hours' must be a non-negative integer" };
  }

  return { hours };
}

async function handleSchedule(res, url) {
  const parsed = parseHours(url);

  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const schedule = await createOptimizedSchedule(parsed.hours, config);
    sendJson(res, 200, schedule);
  } catch (error) {
    if (error instanceof ExternalApiError) {
      sendJson(res, error.statusCode || 502, {
        error: error.message,
        failures: error.failures || undefined
      });
      return;
    }

    sendJson(res, 500, {
      error: "Failed to generate schedule",
      message: error.message
    });
  }
}

async function routeRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/") {
    sendJson(res, 200, {
      service: "Vehicle Maintenance Scheduler",
      endpoints: {
        health: "/health",
        schedule: "/schedule?hours=8"
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/schedule") {
    await handleSchedule(res, url);
    return;
  }

  sendJson(res, 404, { error: "Route not found" });
}

const server = http.createServer((req, res) => {
  runMiddlewares(req, res, middlewares, async () => {
    try {
      await routeRequest(req, res);
    } catch (error) {
      sendJson(res, 500, {
        error: "Unexpected server error",
        message: error.message
      });
    } finally {
      if (typeof res.onFinish === "function") {
        res.onFinish();
      }
    }
  });
});

function listen(port) {
  server.listen(port, config.host, () => {
    console.log(
      `Vehicle maintenance scheduler listening on http://${config.host}:${port}`
    );
  });
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    const busyPort = Number(error.port || config.port);
    const nextPort = busyPort + 1;

    console.log(`Port ${busyPort} is already in use. Trying port ${nextPort}.`);
    listen(nextPort);
    return;
  }

  throw error;
});

listen(config.port);
