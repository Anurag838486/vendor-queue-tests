const STATES = ['REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];
const CHECK_TYPES = ['IDENTITY', 'EDUCATION', 'EMPLOYMENT', 'ADDRESS'];

function makeSeed() {
  const vendors = [
    { id: 'v1', name: 'Swift Verify Co', active: true },
    { id: 'v2', name: 'ClearCheck Partners', active: true },
    { id: 'v3', name: 'Old Ledger Associates', active: false }
  ];

  const requests = [
    { id: 1, checkType: 'IDENTITY', candidateName: 'Ananya Iyer', state: 'REQUESTED', vendorId: null },
    { id: 2, checkType: 'EDUCATION', candidateName: 'Dev Kapoor', state: 'ASSIGNED', vendorId: 'v1' },
    { id: 3, checkType: 'EMPLOYMENT', candidateName: 'Neha Joshi', state: 'IN_PROGRESS', vendorId: 'v2' },
    { id: 4, checkType: 'ADDRESS', candidateName: 'Farhan Ali', state: 'COMPLETED', vendorId: 'v1' },
    { id: 5, checkType: 'IDENTITY', candidateName: 'Ritika Malhotra', state: 'ASSIGNED', vendorId: 'v2' }
  ];

  return { vendors, requests, nextId: 6 };
}

module.exports = { STATES, CHECK_TYPES, makeSeed };
