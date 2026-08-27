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
import { CreateDebateTurnVote20260802000000 } from "../migrations/20260802000000-CreateDebateTurnVote";
import { AddMemberCredentials20260802000001 } from "../migrations/20260802000001-AddMemberCredentials";
import { CreateRefreshTokenSession20260802000002 } from "../migrations/20260802000002-CreateRefreshTokenSession";
import { CreateCommunityChat20260802000003 } from "../migrations/20260802000003-CreateCommunityChat";
import { CreateCommunityOpinion20260802000006 } from "../migrations/20260802000006-CreateCommunityOpinion";
import { AddCommunityMemberDebateIntent20260810000000 } from "../migrations/20260810000000-AddCommunityMemberDebateIntent";
import { BackfillCommunityHostOpinions20260810000001 } from "../migrations/20260810000001-BackfillCommunityHostOpinions";
import { ConnectDebateToCommunity20260810000002 } from "../migrations/20260810000002-ConnectDebateToCommunity";
import { AddDebateTimeoutIndex20260810000004 } from "../migrations/20260810000004-AddDebateTimeoutIndex";
import { LinkCommunityOpinionToMembership20260811000000 } from "../migrations/20260811000000-LinkCommunityOpinionToMembership";
import { AddMemberScore20260811000001 } from "../migrations/20260811000001-AddMemberScore";
import { AddCommunityDebateNotifications20260823000000 } from "../migrations/20260823000000-AddCommunityDebateNotifications";
import { AddCommunityDebateTimeoutNotification20260824000000 } from "../migrations/20260824000000-AddCommunityDebateTimeoutNotification";
import { AddCommunityDebateStartedNotification20260825000000 } from "../migrations/20260825000000-AddCommunityDebateStartedNotification";

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
    CreateDebateTurnVote20260802000000,
    AddMemberCredentials20260802000001,
    CreateRefreshTokenSession20260802000002,
    CreateCommunityChat20260802000003,
    CreateCommunityOpinion20260802000006,
    AddCommunityMemberDebateIntent20260810000000,
    BackfillCommunityHostOpinions20260810000001,
    ConnectDebateToCommunity20260810000002,
    AddDebateTimeoutIndex20260810000004,
    LinkCommunityOpinionToMembership20260811000000,
    AddMemberScore20260811000001,
    AddCommunityDebateNotifications20260823000000,
    AddCommunityDebateTimeoutNotification20260824000000,
    AddCommunityDebateStartedNotification20260825000000,
  ],
  migrationsTableName: "migrations",
  synchronize: false,
});

export default AppDataSource;
