import "./style.css";
import { startRouter, route } from "./router";
import { createGame1v1View } from "./views/game1v1";
import { createRoomView } from "./views/room";

// Hand-rolled routing (see router.ts). "/" is the classic 1v1 screen (local by
// default, with an in-divider toggle to online); "/room/:id" is the N-player
// room reached from the 1v1 screen's "みんなで対戦" button or a shared QR link.
// "/" is registered last so it also serves as the fallback for unknown paths.
startRouter(document.getElementById("app")!, [
  route("/room/:id", () => createRoomView()),
  route("/", () => createGame1v1View()),
]);
