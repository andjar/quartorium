const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node'); // Not used yet, but good to have
const crypto = require('crypto');

// --- Constants ---
const API_BASE_URL = 'http://localhost:8000/api/docs'; // Backend runs on port 8000
const REPOS_DIR = path.join(__dirname, '../repos'); // Relative to backend/test
// CACHE_DIR is the main cache directory.
// CACHE_DIR_RENDERED_DOCS is a subdirectory for the JSON outputs of rendering.
const CACHE_DIR = path.join(__dirname, '../cache');
const CACHE_DIR_RENDERED_DOCS = path.join(CACHE_DIR, 'rendered_docs');
const TEST_REPO_NAME = 'test-repo-cache-integration';
const TEST_REPO_PATH = path.join(REPOS_DIR, TEST_REPO_NAME);
const TEST_DOC_FILENAME = 'doc.qmd';
const TEST_DOC_FILEPATH = path.join(TEST_REPO_PATH, TEST_DOC_FILENAME);
const TEST_IMAGE_FILENAME = 'test_image.png';

// Hardcoded for simplicity, as per subtask instructions
const MOCK_REPO_ID = 'test-repo-id-cache';
const MOCK_USER_ID = 'test-user-id-cache'; // Needed if auth is strict

// --- Helper Functions ---

// Makes an authenticated GET request (simplified: assumes no complex auth for now)
async function getDocView(repoId, filepath, params = {}) {
  try {
    // This is a simplification. Real auth would require a token.
    // We are assuming the test environment might bypass auth or docs.routes.js is modified for testing.
    // For now, we pass repoId and filepath as query params, similar to non-shareToken flow.
    // The docs.routes.js uses req.user.id, which will be undefined here.
    // This will likely fail if isAuthenticated middleware is strictly enforced without a logged-in user.
    // We might need to adjust docs.routes.js or mock authentication for this to fully work.
    const response = await axios.get(`${API_BASE_URL}/view`, {
      params: { repoId, filepath, ...params },
      // headers: { 'Authorization': `Bearer test-token` } // If a test token mechanism exists
    });
    return response;
  } catch (error) {
    if (error.response) {
      console.error('Error getting doc view:', error.response.status, error.response.data);
      return error.response;
    }
    console.error('Error getting doc view (network/config issue):', error.message);
    throw error;
  }
}

async function getCurrentCommitHash(repoPath) {
  return git.resolveRef({ fs, dir: repoPath, ref: 'HEAD' });
}

function calculateCacheFilename(repoId, docFilepath, commitHash) {
  const filepathHash = crypto.createHash('md5').update(docFilepath).digest('hex');
  // Ensure this uses the specific cache for rendered documents
  return path.join(CACHE_DIR_RENDERED_DOCS, `${repoId}-${filepathHash}-${commitHash}.json`);
}

// New helper function for asset cache directory
function calculateAssetCacheDir(repoId, docFilename, commitHash) {
  return path.join(CACHE_DIR, 'assets', repoId, commitHash, path.parse(docFilename).name + '_files');
}

async function createTestRepo() {
  await fs.rm(TEST_REPO_PATH, { recursive: true, force: true }); // Clean up if exists
  await fs.mkdir(TEST_REPO_PATH, { recursive: true });
  await git.init({ fs, dir: TEST_REPO_PATH });
  // Update document content to include an image link
  await fs.writeFile(TEST_DOC_FILEPATH, `# Initial Document\nThis is the first version.\n![A Test Image](./${TEST_IMAGE_FILENAME})`);
  // Create a dummy image file in the repo
  await fs.writeFile(path.join(TEST_REPO_PATH, TEST_IMAGE_FILENAME), 'dummy image content');
  await git.add({ fs, dir: TEST_REPO_PATH, filepath: TEST_DOC_FILENAME });
  // Add the image file to git
  await git.add({ fs, dir: TEST_REPO_PATH, filepath: TEST_IMAGE_FILENAME });
  await git.commit({
    fs,
    dir: TEST_REPO_PATH,
    author: { name: 'Test User', email: 'test@example.com' },
    message: 'Initial commit',
  });
}

async function modifyTestDoc(content, message = 'Modify document') {
  await fs.writeFile(TEST_DOC_FILEPATH, content);
  await git.add({ fs, dir: TEST_REPO_PATH, filepath: TEST_DOC_FILENAME });
  await git.commit({
    fs,
    dir: TEST_REPO_PATH,
    author: { name: 'Test User', email: 'test@example.com' },
    message,
  });
}

// --- Test Suite ---
describe('Document Rendering Cache Integration Tests', () => {
  beforeAll(async () => {
    // Ensure REPOS_DIR and various CACHE_DIR subdirectories exist
    await fs.mkdir(REPOS_DIR, { recursive: true });
    await fs.mkdir(CACHE_DIR_RENDERED_DOCS, { recursive: true });
    // Ensure the root 'assets' directory in CACHE_DIR exists
    await fs.mkdir(path.join(CACHE_DIR, 'assets'), { recursive: true });
    await createTestRepo();
  });

  beforeEach(async () => {
    // Clean up specific cache files and directories before each test
    try {
      // Clean rendered docs cache for MOCK_REPO_ID
      const renderedDocFiles = await fs.readdir(CACHE_DIR_RENDERED_DOCS);
      for (const file of renderedDocFiles) {
        // Only remove files related to MOCK_REPO_ID to avoid interference if other tests use cache
        if (file.startsWith(MOCK_REPO_ID) && file.endsWith('.json')) {
          await fs.unlink(path.join(CACHE_DIR_RENDERED_DOCS, file));
        }
      }

      // Clean assets cache for MOCK_REPO_ID
      const assetCacheDirForRepo = path.join(CACHE_DIR, 'assets', MOCK_REPO_ID);
      try {
        await fs.access(assetCacheDirForRepo); // Check if it exists
        await fs.rm(assetCacheDirForRepo, { recursive: true, force: true });
      } catch (e) {
        // If ENOENT, directory doesn't exist, which is fine for cleanup.
        if (e.code !== 'ENOENT') throw e;
      }
    } catch (error) {
      // Allow ENOENT if CACHE_DIR_RENDERED_DOCS itself doesn't exist (e.g. first run)
      if (error.code !== 'ENOENT') {
        console.error('Error cleaning cache directories:', error);
      }
    }
  });

  afterAll(async () => {
    // Clean up the test repository
    await fs.rm(TEST_REPO_PATH, { recursive: true, force: true });
    // Clean up specific cache for this test run to be tidy
    const assetCacheDirForRepo = path.join(CACHE_DIR, 'assets', MOCK_REPO_ID);
    try { await fs.rm(assetCacheDirForRepo, { recursive: true, force: true }); } catch (e) { if (e.code !== 'ENOENT') console.error("Error cleaning MOCK_REPO_ID asset cache in afterAll", e) }

    try {
      const renderedDocFiles = await fs.readdir(CACHE_DIR_RENDERED_DOCS);
      for (const file of renderedDocFiles) {
        if (file.startsWith(MOCK_REPO_ID)) {
          await fs.unlink(path.join(CACHE_DIR_RENDERED_DOCS, file));
        }
      }
    } catch (e) { if (e.code !== 'ENOENT') console.error("Error cleaning MOCK_REPO_ID doc cache in afterAll", e) }
  });

  it('Test 1: Cache Miss and Initial Cache Creation', async () => {
    console.log('Running Test 1: Cache Miss and Initial Cache Creation');
    const initialCommitHash = await getCurrentCommitHash(TEST_REPO_PATH);
    const expectedRenderedDocCacheFile = calculateCacheFilename(MOCK_REPO_ID, TEST_DOC_FILENAME, initialCommitHash);
    const expectedAssetCacheDir = calculateAssetCacheDir(MOCK_REPO_ID, TEST_DOC_FILENAME, initialCommitHash);

    // 1. Make the first request
    const response = await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    expect(response.data.type).toBe('doc');
    expect(response.data.content).toBeInstanceOf(Array);

    // Check for rendered doc cache file existence
    try {
      await fs.access(expectedRenderedDocCacheFile);
    } catch (e) {
      throw new Error(`Rendered doc cache file ${expectedRenderedDocCacheFile} was not created.`);
    }

    // Check for asset cache directory and file existence
    try {
      await fs.access(expectedAssetCacheDir);
    } catch (e) {
      throw new Error(`Asset cache directory ${expectedAssetCacheDir} was not created.`);
    }
    try {
      await fs.access(path.join(expectedAssetCacheDir, TEST_IMAGE_FILENAME));
    } catch (e) {
      throw new Error(`Asset file ${TEST_IMAGE_FILENAME} was not created in ${expectedAssetCacheDir}.`);
    }

    // Check image src in response
    // Assuming the image is in a paragraph: { type: 'paragraph', content: [ ..., { type: 'image', attrs: { src: '...' } }, ... ] }
    const imageNode = response.data.content
      .find(node => node.type === 'paragraph')?.content
      ?.find(innerNode => innerNode.type === 'image');

    expect(imageNode).toBeDefined();
    const expectedImgSrc = `/api/assets/${MOCK_REPO_ID}/${initialCommitHash}/${path.parse(TEST_DOC_FILENAME).name}_files/${TEST_IMAGE_FILENAME}`;
    expect(imageNode.attrs.src).toBe(expectedImgSrc);

    console.log('Test 1 Passed');
  });

  it('Test 2: Cache Hit', async () => {
    console.log('Running Test 2: Cache Hit');
    const initialCommitHash = await getCurrentCommitHash(TEST_REPO_PATH);
    const expectedCacheFile = calculateCacheFilename(MOCK_REPO_ID, TEST_DOC_FILENAME, initialCommitHash);

    // 1. First request (to populate cache)
    await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);

    // Check it was created
    try { await fs.access(expectedCacheFile); } catch (e) {
      throw new Error(`Cache file ${expectedCacheFile} was not created by the first request.`);
    }
    const initialCacheStat = await fs.stat(expectedCacheFile);

    // Introduce a small delay to ensure modification time would differ if file was rewritten
    await new Promise(resolve => setTimeout(resolve, 100));

    // 2. Second request for the same document
    const response = await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);
    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();

    const cacheStatAfterSecondCall = await fs.stat(expectedCacheFile);
    // Check that the file was not modified (cache hit means no rewrite)
    expect(cacheStatAfterSecondCall.mtimeMs).toBe(initialCacheStat.mtimeMs);
    console.log('Test 2 Passed (assertions pending full auth solution)');
  });

  it('Test 3: Cache Invalidation after Git Commit', async () => {
    console.log('Running Test 3: Cache Invalidation after Git Commit');
    const firstCommitHash = await getCurrentCommitHash(TEST_REPO_PATH);
    const firstCacheFile = calculateCacheFilename(MOCK_REPO_ID, TEST_DOC_FILENAME, firstCommitHash);

    // 1. Request to ensure initial cache is there
    await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);
    try { await fs.access(firstCacheFile); } catch (e) {
      throw new Error(`Initial cache file ${firstCacheFile} was not created.`);
    }

    // 2. Modify the document and commit
    await modifyTestDoc('# Updated Document\nThis is the second version.', 'Second commit');
    const secondCommitHash = await getCurrentCommitHash(TEST_REPO_PATH);
    expect(secondCommitHash).not.toBe(firstCommitHash);
    const secondCacheFile = calculateCacheFilename(MOCK_REPO_ID, TEST_DOC_FILENAME, secondCommitHash);

    // 3. Request the modified document
    const response = await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);
    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    // A more specific check for updated content would be good, e.g., checking response.data.content
    // For now, we rely on a new cache file being created for the doc.
    const expectedNewAssetCacheDir = calculateAssetCacheDir(MOCK_REPO_ID, TEST_DOC_FILENAME, secondCommitHash);

    // Check for the new rendered doc cache file
    try {
      await fs.access(secondCacheFile);
    } catch (e) {
      throw new Error(`New rendered doc cache file ${secondCacheFile} was not created after commit.`);
    }

    // Check for new asset cache directory and file existence
    try {
      await fs.access(expectedNewAssetCacheDir);
    } catch (e) {
      throw new Error(`New asset cache directory ${expectedNewAssetCacheDir} was not created after commit.`);
    }
    try {
      await fs.access(path.join(expectedNewAssetCacheDir, TEST_IMAGE_FILENAME));
    } catch (e) {
      throw new Error(`Asset file ${TEST_IMAGE_FILENAME} was not created in new asset cache dir ${expectedNewAssetCacheDir}.`);
    }

    // Check image src in response for the new commit hash
    const imageNode = response.data.content
      .find(node => node.type === 'paragraph')?.content
      ?.find(innerNode => innerNode.type === 'image');

    expect(imageNode).toBeDefined();
    const expectedImgSrc = `/api/assets/${MOCK_REPO_ID}/${secondCommitHash}/${path.parse(TEST_DOC_FILENAME).name}_files/${TEST_IMAGE_FILENAME}`;
    expect(imageNode.attrs.src).toBe(expectedImgSrc);
    console.log('Test 3 Passed');
  });


  // Test 4: Cache Behavior with Different Branches (Simulated)
  // This test is more complex due to branch switching and ensuring the endpoint uses the correct branch.
  // The current /api/docs/view endpoint uses HEAD by default for non-shareToken requests.
  // To test specific branches properly without a shareToken, we'd need to:
  // 1. Checkout the branch in the test repo BEFORE the getDocView call.
  // 2. The getDocView call would then naturally use the current HEAD of the checked-out branch.
  it('Test 4: Cache Behavior with Different Branches', async () => {
    console.log('Running Test 4: Cache Behavior with Different Branches');

    // Initial state (main branch)
    await git.checkout({ fs, dir: TEST_REPO_PATH, ref: 'main' }); // Assuming default branch is main
    const mainBranchCommitHash = await getCurrentCommitHash(TEST_REPO_PATH);
    const mainBranchCacheFile = calculateCacheFilename(MOCK_REPO_ID, TEST_DOC_FILENAME, mainBranchCommitHash);

    // 1. Request on main branch to ensure cache
    let response = await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);
    expect(response.status).toBe(200);
    try { await fs.access(mainBranchCacheFile); } catch (e) {
      throw new Error(`Main branch cache file ${mainBranchCacheFile} was not created.`);
    }

    // 2. Create and checkout a new branch, modify doc, commit
    const featureBranchName = 'feature/test-branch';
    await git.branch({ fs, dir: TEST_REPO_PATH, ref: featureBranchName, checkout: true });
    await modifyTestDoc('# Feature Branch Document\nContent on feature branch.', 'Commit on feature branch');
    const featureBranchCommitHash = await getCurrentCommitHash(TEST_REPO_PATH);
    const featureBranchCacheFile = calculateCacheFilename(MOCK_REPO_ID, TEST_DOC_FILENAME, featureBranchCommitHash);
    expect(featureBranchCommitHash).not.toBe(mainBranchCommitHash);

    // 3. Request on feature branch (should be a cache miss, then create)
    response = await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME); // API will use current HEAD (feature-branch)
    expect(response.status).toBe(200);
    // Add content check for feature branch specific content if possible
    try { await fs.access(featureBranchCacheFile); } catch (e) {
      throw new Error(`Feature branch cache file ${featureBranchCacheFile} was not created.`);
    }
    const mainCacheStatBefore = await fs.stat(mainBranchCacheFile);


    // 4. Request again on feature branch (should be a cache hit)
    const featureCacheStatBefore = await fs.stat(featureBranchCacheFile);
    await new Promise(resolve => setTimeout(resolve, 50)); // ensure mtime can differ
    response = await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);
    expect(response.status).toBe(200);
    const featureCacheStatAfter = await fs.stat(featureBranchCacheFile);
    expect(featureCacheStatAfter.mtimeMs).toBe(featureCacheStatBefore.mtimeMs); // Cache hit

    // 5. Checkout main branch again
    await git.checkout({ fs, dir: TEST_REPO_PATH, ref: 'main' });

    // 6. Request on main branch (should be a cache hit from its original cache file)
    await new Promise(resolve => setTimeout(resolve, 50)); // ensure mtime can differ
    response = await getDocView(MOCK_REPO_ID, TEST_DOC_FILENAME);
    expect(response.status).toBe(200);
    const mainCacheStatAfter = await fs.stat(mainBranchCacheFile);
    expect(mainCacheStatAfter.mtimeMs).toBe(mainCacheStatBefore.mtimeMs); // Cache hit on main branch file

    console.log('Test 4 Passed (assertions pending full auth solution)');
  });

});

// Rudimentary test runner if not using Jest/Mocha
async function runTests() {
  // This is a placeholder. In a real setup, you'd use Jest, Mocha, or similar.
  // For now, these tests will have `expect` which is Jest/Jasmine syntax.
  // To run this standalone, one would need to implement `describe`, `it`, `expect`, etc.
  console.warn("This test suite is designed for a Jest-like environment.");
  console.warn("Attempting to run with placeholder logic, expect errors if not in such environment.");

  // A simple way to run if `describe` and `it` are polyfilled or using a runner
  // For now, this function won't execute the tests directly without a test runner.
  // You would typically run `jest backend/test/cache.integration.test.js`
}

// If running file directly (and not via a test runner)
if (require.main === module) {
  console.log("Please run these tests using a test runner like Jest or Mocha.");
  // runTests(); // This would fail without the test runner's environment
}

module.exports = {
  // Can export functions if needed by an external runner
};

// Basic expect implementation for standalone demo (very simplified)
// In a real scenario, use Jest/Jasmine's expect
global.expect = (actual) => ({
  toBe: (expected) => {
    if (actual !== expected) throw new Error(`Expected ${actual} to be ${expected}`);
  },
  toBeDefined: () => {
    if (typeof actual === 'undefined') throw new Error(`Expected value to be defined, but it was undefined.`);
  },
  toBeInstanceOf: (expectedConstructor) => {
    if (!(actual instanceof expectedConstructor)) throw new Error(`Expected ${actual} to be instance of ${expectedConstructor.name}`);
  },
  not: {
    toBe: (expected) => {
      if (actual === expected) throw new Error(`Expected ${actual} not to be ${expected}`);
    }
  }
});

// Basic describe/it/beforeAll/beforeEach/afterAll for standalone demo
global.testContext = { currentSuite: null, tests: [] };
global.describe = (name, fn) => {
  console.log(`\nDESCRIBE: ${name}`);
  global.testContext.currentSuite = { name, tests: [], beforeAll: [], beforeEach: [], afterAll: [] };
  fn();
  global.testContext.tests.push(global.testContext.currentSuite);
  global.testContext.currentSuite = null; // Reset for potential nested describes
};
global.it = (name, fn) => {
  if (global.testContext.currentSuite) global.testContext.currentSuite.tests.push({ name, fn });
  else console.error("`it` called outside of a `describe` block");
};
global.beforeAll = (fn) => { if (global.testContext.currentSuite) global.testContext.currentSuite.beforeAll.push(fn); };
global.beforeEach = (fn) => { if (global.testContext.currentSuite) global.testContext.currentSuite.beforeEach.push(fn); };
global.afterAll = (fn) => { if (global.testContext.currentSuite) global.testContext.currentSuite.afterAll.push(fn); };

async function reallyRunTestsManual() {
  for (const suite of global.testContext.tests) {
    console.log(`\n--- Running Suite: ${suite.name} ---`);
    for (const beforeAllFn of suite.beforeAll) await beforeAllFn();
    for (const test of suite.tests) {
      console.log(`  IT: ${test.name}`);
      for (const beforeEachFn of suite.beforeEach) await beforeEachFn();
      try {
        await test.fn();
        console.log(`    PASSED: ${test.name}`);
      } catch (e) {
        console.error(`    FAILED: ${test.name}`, e.message, e.stack ? e.stack.split('\n')[1].trim() : '');
      }
    }
    for (const afterAllFn of suite.afterAll) await afterAllFn();
  }
}

// Self-execute if not in a proper test environment
if (require.main === module) {
  console.log("Attempting to run tests with simplified manual runner...");
  // This will manually execute the describe blocks now that they are defined.
  // Need to re-require or ensure the describe calls happen after these definitions.
  // This is getting hacky; a real test runner is much preferred.
  // For now, I'll assume a test runner like Jest will pick up the file.
  // If I were to make this truly self-executable for the demo, I'd put all `describe` calls
  // into a main async function and call it here.
  // For now, the goal is to provide the test *logic*.
  console.log("To execute, use a test runner like Jest: `npx jest backend/test/cache.integration.test.js`");
  console.log("Or, if you have Jest installed globally/locally: `jest backend/test/cache.integration.test.js`");
  // As a fallback for this tool, I'll try to run it manually.
  // This requires the `describe` calls to be re-evaluated or for this to be structured differently.
  // The `create_file_with_block` tool doesn't allow re-running parts of the script.
  // So, this manual runner won't work as is.
  // The primary deliverable is the test suite structure and logic.
}
