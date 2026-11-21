{ pkgs ? import <nixpkgs> {} }:

import ./shell.nix { inherit pkgs; }
