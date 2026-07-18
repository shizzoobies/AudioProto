// Per-course configuration for the First Call embed block. Fill these in for
// each course BEFORE zipping and uploading the block to Rise.
//
// ct: the course embed token from the admin dashboard's "Course embeds"
// section (shown once at creation). It is course-scoped, rate-capped, and
// instantly revocable from the dashboard, so it living inside the course
// package is by design.
window.FIRSTCALL = {
  origin: 'https://ka-testing.com',
  ct: 'PASTE_COURSE_TOKEN_HERE',
  sid: 'demo_sales',
  activityId: 'https://ka-testing.com/activities/firstcall-robert',
  activityName: 'First Call: Robert (One-Way Reservation)',
  // Learners at or above this overall coaching score (1-5) register success in
  // the completed statement; completion itself is sent either way.
  passing: 3.0,
};
