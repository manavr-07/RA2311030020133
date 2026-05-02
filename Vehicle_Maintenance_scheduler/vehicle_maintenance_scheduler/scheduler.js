class ExternalApiError extends Error {
  constructor(message, statusCode, endpoint) {
    super(message);
    this.name = "ExternalApiError";
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

function getConfig() {
  return {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || "127.0.0.1",
    externalApiBaseUrl:
      process.env.EXTERNAL_API_BASE_URL ||
      "http://20.207.122.201/evaluation-service",
    apiKey: process.env.API_KEY,
    apiAuthHeader: process.env.API_AUTH_HEADER || "Authorization",
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 8000)
  };
}

function buildApiUrl(endpoint, baseUrl) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedEndpoint = endpoint.startsWith("/")
    ? endpoint.slice(1)
    : endpoint;

  return new URL(normalizedEndpoint, normalizedBaseUrl);
}

function buildAuthHeaderValue(apiKey, headerName) {
  if (headerName.toLowerCase() !== "authorization") {
    return apiKey;
  }

  return apiKey.toLowerCase().startsWith("bearer ") ? apiKey : `Bearer ${apiKey}`;
}

function assertApiConfig(config) {
  if (!config.externalApiBaseUrl) {
    throw new ExternalApiError("EXTERNAL_API_BASE_URL is not configured", 500);
  }

  if (!config.apiKey) {
    throw new ExternalApiError("API_KEY is not configured", 500);
  }
}

async function fetchJson(endpoint, config) {
  assertApiConfig(config);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const url = buildApiUrl(endpoint, config.externalApiBaseUrl);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        [config.apiAuthHeader]: buildAuthHeaderValue(config.apiKey, config.apiAuthHeader)
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new ExternalApiError(
        `External API returned ${response.status}`,
        response.status,
        endpoint
      );
    }

    return response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ExternalApiError("External API request timed out", 504, endpoint);
    }

    if (error instanceof ExternalApiError) {
      throw error;
    }

    throw new ExternalApiError(error.message, 502, endpoint);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSchedulingData(config) {
  const [depotsResult, vehiclesResult] = await Promise.allSettled([
    fetchJson("depots", config),
    fetchJson("vehicles", config)
  ]);

  const failures = [depotsResult, vehiclesResult]
    .filter((result) => result.status === "rejected")
    .map((result) => ({
      endpoint: result.reason.endpoint,
      statusCode: result.reason.statusCode,
      message: result.reason.message
    }));

  if (failures.length > 0) {
    const error = new ExternalApiError("Unable to fetch required scheduling data", 502);
    error.failures = failures;
    throw error;
  }

  return {
    depots: depotsResult.value,
    vehicles: vehiclesResult.value
  };
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value.vehicles)) return value.vehicles;
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.items)) return value.items;
  }

  return [];
}

function getFirstDefined(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function normalizeTask(task, fallbackId) {
  const taskId = getFirstDefined(task, ["TaskID", "taskId", "taskID", "id"]);
  const duration = Number(getFirstDefined(task, ["Duration", "duration", "hours"]));
  const impact = Number(getFirstDefined(task, ["Impact", "impact", "score"]));

  if (!Number.isFinite(duration) || !Number.isFinite(impact)) {
    return null;
  }

  if (duration <= 0 || impact < 0) {
    return null;
  }

  return {
    TaskID: String(taskId || fallbackId),
    Duration: duration,
    Impact: impact
  };
}

function extractVehicleTasks(vehiclesPayload) {
  const vehicles = asArray(vehiclesPayload);
  const tasks = [];

  vehicles.forEach((vehicle, vehicleIndex) => {
    const nestedTasks = asArray(
      vehicle.maintenanceTasks || vehicle.tasks || vehicle.maintenance || []
    );

    if (nestedTasks.length > 0) {
      nestedTasks.forEach((task, taskIndex) => {
        const normalized = normalizeTask(
          task,
          `vehicle-${vehicleIndex + 1}-task-${taskIndex + 1}`
        );

        if (normalized) tasks.push(normalized);
      });
      return;
    }

    const normalized = normalizeTask(vehicle, `vehicle-${vehicleIndex + 1}-task-1`);
    if (normalized) tasks.push(normalized);
  });

  return tasks;
}

function toIntegerHours(value) {
  const rounded = Math.round(Number(value));

  if (!Number.isFinite(rounded)) {
    return NaN;
  }

  return rounded;
}

function optimizeTasks(tasks, maxHours) {
  const capacity = toIntegerHours(maxHours);

  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new Error("hours must be a non-negative integer");
  }

  if (capacity === 0 || tasks.length === 0) {
    return {
      totalImpact: 0,
      selectedTasks: []
    };
  }

  const dp = Array.from({ length: capacity + 1 }, () => ({
    impact: 0,
    selectedIndexes: []
  }));

  tasks.forEach((task, taskIndex) => {
    const duration = toIntegerHours(task.Duration);

    if (!Number.isInteger(duration) || duration <= 0 || duration > capacity) {
      return;
    }

    for (let hours = capacity; hours >= duration; hours -= 1) {
      const candidateImpact = dp[hours - duration].impact + task.Impact;

      if (candidateImpact > dp[hours].impact) {
        dp[hours] = {
          impact: candidateImpact,
          selectedIndexes: [...dp[hours - duration].selectedIndexes, taskIndex]
        };
      }
    }
  });

  return {
    totalImpact: dp[capacity].impact,
    selectedTasks: dp[capacity].selectedIndexes.map((index) => tasks[index])
  };
}

async function createOptimizedSchedule(maxHours, config = getConfig()) {
  const { vehicles } = await fetchSchedulingData(config);
  const tasks = extractVehicleTasks(vehicles);
  const optimized = optimizeTasks(tasks, maxHours);

  return {
    maxHours,
    totalImpact: optimized.totalImpact,
    selectedTasks: optimized.selectedTasks
  };
}

module.exports = {
  ExternalApiError,
  buildAuthHeaderValue,
  buildApiUrl,
  createOptimizedSchedule,
  extractVehicleTasks,
  fetchSchedulingData,
  getConfig,
  optimizeTasks
};
