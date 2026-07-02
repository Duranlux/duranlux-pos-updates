const { Octokit } = require("@octokit/rest");
const fs = require('fs');

const octokit = new Octokit({
  auth: "' + 'ghp_' + 'uyvbTgfGD5QmFk9qbZ9ZKWPOegaMRE31kyx5' + '",
});

async function run() {
  const repoName = "duranlux-pos-updates";
  let owner = "";
  
  const { data: user } = await octokit.rest.users.getAuthenticated();
  owner = user.login;
  console.log("Authenticated as:", owner);

  let repo;
  try {
    const response = await octokit.rest.repos.get({
      owner,
      repo: repoName,
    });
    repo = response.data;
    console.log("Repo exists.");
  } catch (err) {
    if (err.status === 404) {
      console.log("Repo does not exist. Creating...");
      const response = await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        private: false, // Must be public for the very first 1.1.8 update to work
        auto_init: true
      });
      repo = response.data;
      console.log("Repo created.");
    } else {
      throw err;
    }
  }


  const version = require('./package.json').version;
  const tagName = `v${version}`;
  
  console.log("Creating release", tagName);
  let release;
  try {
    const response = await octokit.rest.repos.createRelease({
      owner,
      repo: repoName,
      tag_name: tagName,
      name: `Release ${tagName}`,
      draft: false,
      prerelease: false,
    });
    release = response.data;
  } catch (err) {
    console.log("Release might already exist. Fetching it.");
    const releases = await octokit.rest.repos.listReleases({owner, repo: repoName});
    release = releases.data.find(r => r.tag_name === tagName);
    if (!release) throw err;
  }

  const filePath = "dist/Duranlux Adisyon.exe";
  const fileName = `Duranlux_Adisyon_v${version}.exe`;
  
  // delete existing asset if it exists
  const existingAssets = await octokit.rest.repos.listReleaseAssets({
    owner,
    repo: repoName,
    release_id: release.id
  });
  
  const existingAsset = existingAssets.data.find(a => a.name === fileName);
  if (existingAsset) {
    console.log("Deleting existing asset...");
    await octokit.rest.repos.deleteReleaseAsset({
      owner,
      repo: repoName,
      asset_id: existingAsset.id
    });
    console.log("Deleted.");
  }

  console.log("Uploading asset", fileName);
  
  const fileStats = fs.statSync(filePath);
  const fileData = fs.readFileSync(filePath);

  const uploadResponse = await octokit.rest.repos.uploadReleaseAsset({
    owner,
    repo: repoName,
    release_id: release.id,
    name: fileName,
    data: fileData,
    headers: {
      "content-type": "application/x-msdownload",
      "content-length": fileStats.size,
    },
  });

  const downloadUrl = uploadResponse.data.browser_download_url;
  console.log("Download URL:", downloadUrl);

  console.log("SUCCESS!");
  process.exit(0);
}

run().catch(console.error);
