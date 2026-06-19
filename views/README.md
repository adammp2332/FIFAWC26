# World Cup Prediction App

This is a simple Node.js/Express web application that allows users to predict the outcome of World Cup matches and optionally submit a score for each match.  It uses PostgreSQL to store match data and predictions.

## Features

* Displays a list of matches with participating teams and scheduled dates.
* Users can select the winner (Team A, Draw, or Team B) and optionally enter a predicted score.
* Predictions are saved to a PostgreSQL database.

## Prerequisites

* Node.js (version 16 or later)
* A PostgreSQL database (Render can provision a free database automatically via the provided `render.yaml`)

## Installation

1. Clone the repository:

   ```bash
   git clone <YOUR-REPO-URL>
   cd worldcup-app
