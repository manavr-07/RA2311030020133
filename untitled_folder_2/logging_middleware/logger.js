function logger(req, res, next) {
  const startedAt = Date.now();

  res.onFinish = () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${durationMs}ms`
    );
  };

  next();
}

module.exports = logger;
