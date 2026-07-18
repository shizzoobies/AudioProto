// Local/same-origin test configuration for the block-test surface. The course
// token comes from the page URL (?ct=...), so this file stays static. The real
// per-course config lives in rise-block/config.js.
window.FIRSTCALL = {
  origin: window.location.origin,
  ct: '',
  sid: 'demo_sales',
  activityId: 'https://ka-testing.com/activities/firstcall-robert',
  activityName: 'First Call: Robert (One-Way Reservation)',
  passing: 3.0,
};
