// Test-only fixture for existing U1/U2 business/UI tests; never a production input.
jest.mock('../src/teacherUnits/releaseAvailability', () => ({
  teacherUnitsAvailable: () => true,
  requireTeacherUnitsAvailable: () => {},
}));
