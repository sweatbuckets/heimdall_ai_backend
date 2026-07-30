import "dotenv/config";
import "reflect-metadata";
import { DataSource } from "typeorm";
import { debateEntities } from "./typeorm.config";
import { CreateDebateAnalysisSchema20260711000000 } from "../migrations/20260711000000-CreateDebateAnalysisSchema";
import { AddDebateTurnAnalysisStatus20260711000001 } from "../migrations/20260711000001-AddDebateTurnAnalysisStatus";
import { CreateMemberTable20260711000002 } from "../migrations/20260711000002-CreateMemberTable";
import { AddDebateSpeakerMemberForeignKeys20260711000003 } from "../migrations/20260711000003-AddDebateSpeakerMemberForeignKeys";
import { AddDebateCurrentTurnState20260711000004 } from "../migrations/20260711000004-AddDebateCurrentTurnState";
import { AddDebateTurnAnalysisProcessingStartedAt20260721000000 } from "../migrations/20260721000000-AddDebateTurnAnalysisProcessingStartedAt";
import { AddDebateJudgingStartedAt20260730000000 } from "../migrations/20260730000000-AddDebateJudgingStartedAt";
import { RenameFinalFactCheckingToDebateFinalized20260730000001 } from "../migrations/20260730000001-RenameFinalFactCheckingToDebateFinalized";
import { RemoveFactCheckQueuedStatus20260730000002 } from "../migrations/20260730000002-RemoveFactCheckQueuedStatus";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required to initialize the TypeORM DataSource.",
  );
}

const AppDataSource = new DataSource({
  type: "postgres",
  url: databaseUrl,
  entities: [...debateEntities],
  migrations: [
    CreateDebateAnalysisSchema20260711000000,
    AddDebateTurnAnalysisStatus20260711000001,
    CreateMemberTable20260711000002,
    AddDebateSpeakerMemberForeignKeys20260711000003,
    AddDebateCurrentTurnState20260711000004,
    AddDebateTurnAnalysisProcessingStartedAt20260721000000,
    AddDebateJudgingStartedAt20260730000000,
    RenameFinalFactCheckingToDebateFinalized20260730000001,
    RemoveFactCheckQueuedStatus20260730000002,
  ],
  migrationsTableName: "migrations",
  synchronize: false,
});

export default AppDataSource;
