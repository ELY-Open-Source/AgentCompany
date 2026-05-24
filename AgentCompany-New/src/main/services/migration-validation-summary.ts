export interface MigrationFailureView {
  table: string;
  reason: string;
  detail: string;
}

export interface MigrationValidationSummary {
  requiredTableCount: number;
  presentTableCount: number;
  missingTableCount: number;
  totalSourceRows: number;
  rowsWithIntegrityFailures: number;
  rowCoverageBasisPoints: number;
  checksumCoverageBasisPoints: number;
  idMapCoverageBasisPoints: number;
  relationFailureCount: number;
  passed: boolean;
  thresholds: {
    rowCoverageBasisPoints: number;
    checksumCoverageBasisPoints: number;
    idMapCoverageBasisPoints: number;
  };
}

const BASIS_POINTS = 10000;
const ROW_COVERAGE_TARGET = 9900;

export function buildMigrationValidationSummary(input: {
  requiredTables: string[];
  tableCounts: Record<string, number>;
  tableChecksums: Record<string, string>;
  idMaps: Record<string, string[]>;
  idMappedTables: string[];
  failures: MigrationFailureView[];
}): MigrationValidationSummary {
  const presentTableCount = Object.keys(input.tableCounts).length;
  const missingTableCount = input.requiredTables.length - presentTableCount;
  const totalSourceRows = sum(Object.values(input.tableCounts));
  const rowsWithIntegrityFailures = countFailedRows(input.failures);
  const rowCoverageBasisPoints = ratioBasisPoints(Math.max(0, totalSourceRows - rowsWithIntegrityFailures), totalSourceRows);
  const checksumCoverageBasisPoints = ratioBasisPoints(Object.keys(input.tableChecksums).length, presentTableCount);
  const idMapSourceRows = sum(input.idMappedTables.map((table) => input.tableCounts[table] ?? 0));
  const idMappedRows = sum(input.idMappedTables.map((table) => input.idMaps[table]?.length ?? 0));
  const idMapCoverageBasisPoints = ratioBasisPoints(idMappedRows, idMapSourceRows);
  const relationFailureCount = input.failures.filter((failure) => failure.reason !== "missing_table").length;
  const passed = missingTableCount === 0
    && rowCoverageBasisPoints >= ROW_COVERAGE_TARGET
    && checksumCoverageBasisPoints === BASIS_POINTS
    && idMapCoverageBasisPoints === BASIS_POINTS
    && relationFailureCount === 0;
  return {
    requiredTableCount: input.requiredTables.length,
    presentTableCount,
    missingTableCount,
    totalSourceRows,
    rowsWithIntegrityFailures,
    rowCoverageBasisPoints,
    checksumCoverageBasisPoints,
    idMapCoverageBasisPoints,
    relationFailureCount,
    passed,
    thresholds: {
      rowCoverageBasisPoints: ROW_COVERAGE_TARGET,
      checksumCoverageBasisPoints: BASIS_POINTS,
      idMapCoverageBasisPoints: BASIS_POINTS,
    },
  };
}

function countFailedRows(failures: MigrationFailureView[]): number {
  const keys = new Set<string>();
  for (const failure of failures) {
    if (failure.reason === "missing_table" || failure.reason === "missing_column") continue;
    keys.add(`${failure.table}:${failure.detail.split(" -> ")[0]}`);
  }
  return keys.size;
}

function ratioBasisPoints(numerator: number, denominator: number): number {
  if (denominator === 0) return BASIS_POINTS;
  return Math.floor((numerator / denominator) * BASIS_POINTS);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
