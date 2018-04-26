# Collab UI Release

[![license](https://img.shields.io/github/license/ciscospark/react-ciscospark.svg)](https://github.com/collab-ui/collab-ui-release/blob/master/LICENSE)

> @collab-ui/release

Collab UI Release is a NPM tool to automate Collab UI publishing tasks.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Contribute](#contribute)
- [License](#license)

## Install

Install and manage the Collab UI Release using NPM. You may use `yarn` or `npm`. By default, yarn/npm installs packages to node_modules/.

`npm install @collab-ui/release --save`

or

`yarn add @collab-ui/release`

## Usage

NPM tool to automate toolkit publishing tasks.  Running this tool in one of the collab-ui repos will accomplish the following:
* Bump the semver version in package.json according to which option you choose:
  * major -  **2**.0.0
  * minor - 2.**1**.0
  * patch - 2.0.**1**
  * custom - 2.0.0**-rc.1** (use for alphas, betas and release candidates)
* Query GitHub to get all commits since last tagged release.
* Extract commit messages and format changelogs.
* Tag commit with new version and create a GitHub release.
* Publish the new version to Artifactory.
* (Coming Soon) Send message to Spark Rooms announcing changes.

## Contribute

See [the contributing file](CONTRIBUTING.md)!

PRs accepted.

## License

[© 2014-2018 Cisco and/or its affiliates. All Rights Reserved.](../LICENSE)
