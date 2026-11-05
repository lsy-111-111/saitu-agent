"use strict";

const path = require("node:path");

const probeRoot = process.env.PM2_PROBE_ROOT;
if (!probeRoot || !probeRoot.startsWith("/tmp/resume-ai-pm2-probe.")) {
  throw new Error("PM2_PROBE_ROOT must be an isolated probe directory");
}

module.exports = {
  apps: [
    {
      name: "topology-probe",
      cwd: probeRoot,
      script: "/bin/sleep",
      interpreter: "none",
      args: "120",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      out_file: path.join(probeRoot, "out.log"),
      error_file: path.join(probeRoot, "error.log"),
      combine_logs: true,
      max_memory_restart: "768M",
      restart_delay: 1000,
      exp_backoff_restart_delay: 100,
      min_uptime: "10s",
      max_restarts: 10,
      kill_timeout: 10000,
      listen_timeout: 15000
    }
  ]
};
