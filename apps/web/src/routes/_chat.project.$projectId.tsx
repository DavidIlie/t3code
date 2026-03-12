import { createFileRoute } from "@tanstack/react-router";
import ProjectLandingPage from "../components/ProjectLandingPage";

export const Route = createFileRoute("/_chat/project/$projectId")({
  component: ProjectLandingPage,
});
