const assert = require("node:assert/strict");
const test = require("node:test");
const {
  resolveAnalysisMetadata
} = require("../services/analysisMetadataService");

const VIDEO_ID = "Y4QddX4sGjg";
const CHANNEL_ID = "UC1234567890123456789012";

test("resolves missing creator identity before transcript analysis", async () => {
  let requestedVideoId = null;
  const result = await resolveAnalysisMetadata({
    videoId: VIDEO_ID,
    title: null,
    creator: null,
    channelId: null,
    channelHandle: null,
    channelUrl: null,
    publishedAt: null
  }, {
    async getVideo(videoId) {
      requestedVideoId = videoId;
      return {
        videoId,
        title: "YouTube API Title",
        channelId: CHANNEL_ID,
        channelTitle: "Resolved Creator",
        publishedAt: "2026-09-02T09:30:00Z",
        publishedAtSource: "youtube_api"
      };
    }
  });

  assert.equal(requestedVideoId, VIDEO_ID);
  assert.equal(result.creator, "Resolved Creator");
  assert.equal(result.channelId, CHANNEL_ID);
  assert.equal(result.channelUrl, `https://www.youtube.com/channel/${CHANNEL_ID}`);
  assert.equal(result.publishedAt, "2026-09-02T09:30:00Z");
  assert.equal(result.title, "YouTube API Title");
});

test("does not spend YouTube quota when a strong identity is present", async () => {
  let calls = 0;
  const input = {
    videoId: VIDEO_ID,
    creator: "Existing Creator",
    channelHandle: "@existing"
  };
  const result = await resolveAnalysisMetadata(input, {
    async getVideo() {
      calls += 1;
      throw new Error("must not be called");
    }
  });

  assert.equal(calls, 0);
  assert.equal(result.creator, "Existing Creator");
  assert.equal(result.channelHandle, "@existing");
});

test("keeps a usable creator-name fallback when YouTube is temporarily unavailable", async () => {
  const result = await resolveAnalysisMetadata({
    videoId: VIDEO_ID,
    creator: "Fallback Creator"
  }, {
    async getVideo() {
      const error = new Error("timeout");
      error.code = "YOUTUBE_TIMEOUT";
      error.retryable = true;
      throw error;
    }
  });

  assert.equal(result.creator, "Fallback Creator");
});

test("fails before transcript and Gemini when no creator identity can be resolved", async () => {
  await assert.rejects(
    () => resolveAnalysisMetadata({ videoId: VIDEO_ID }, {
      async getVideo() {
        const error = new Error("not configured");
        error.code = "YOUTUBE_NOT_CONFIGURED";
        error.retryable = false;
        throw error;
      }
    }),
    error => error.code === "YOUTUBE_NOT_CONFIGURED" && error.status === 503
  );
});
