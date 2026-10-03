#!/bin/sh
# Xcode Cloud: the Xcode project isn't stored in git; it's generated from project.yml.
set -e
brew install xcodegen
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
xcodegen generate
