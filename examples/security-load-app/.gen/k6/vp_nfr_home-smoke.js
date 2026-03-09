import http from "k6/http";
import { check } from "k6";

function falsePositiveUrl(target) {
  const url = new URL(target);
  const suffix = "__shipflow_false_positive__";
  url.pathname = url.pathname.endsWith("/") ? url.pathname + suffix : url.pathname + "/" + suffix;
  return url.toString();
}

export const options = {
  stages: [{"duration":"5s","target":10},{"duration":"15s","target":10}],
  thresholds: {
    http_req_duration: ["p(95)<400"],
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  const res = http.get("http://localhost:3000/");
  const controlRes = http.get(falsePositiveUrl("http://localhost:3000/"));
  check(res, { "status is 200": (r) => r.status === 200 });
  check(controlRes, { "false positive control diverges from expected status": (r) => r.status !== 200 });
}
