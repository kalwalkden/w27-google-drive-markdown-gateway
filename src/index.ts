import express from "express";
import type { Express } from "express";

export function createApp(): Express {
  return express();
}
