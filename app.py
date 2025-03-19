from flask import Flask, render_template, request, jsonify, session
import pandas as pd
import numpy as np
import json
import os
from datetime import datetime
import uuid
import matplotlib.pyplot as plt
import seaborn as sns
import io
import base64
from scipy import stats
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.metrics import mutual_info_score
import sdv
from sdv.single_table import (
    GaussianCopulaSynthesizer,
    CTGANSynthesizer,
    CopulaGANSynthesizer,
)
from sdv.evaluation.single_table import evaluate_quality
from sdv.metadata import SingleTableMetadata
import matplotlib

matplotlib.use("Agg")  # Use non-interactive backend

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.config["UPLOAD_FOLDER"] = "uploads"
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB max upload

# Create upload folder if it doesn't exist
os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file part"})

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"})

    if file and file.filename.endswith((".csv", ".xlsx")):
        # Generate unique filename
        filename = f"{uuid.uuid4()}_{file.filename}"
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        # Read the data
        if file.filename.endswith(".csv"):
            df = pd.read_csv(filepath)
        else:
            df = pd.read_excel(filepath)

        # Store file path in session
        session["filepath"] = filepath
        session["filename"] = file.filename

        # Get basic data info
        data_info = {
            "rows": len(df),
            "columns": len(df.columns),
            "column_names": df.columns.tolist(),
            "dtypes": df.dtypes.astype(str).to_dict(),
            "preview": df.head(5).to_dict(orient="records"),
        }

        return jsonify({"success": True, "data_info": data_info})

    return jsonify({"error": "Invalid file type. Please upload CSV or Excel file."})


@app.route("/get_columns", methods=["GET"])
def get_columns():
    if "filepath" not in session:
        return jsonify({"error": "No data uploaded"})

    filepath = session["filepath"]

    # Read the data
    if filepath.endswith(".csv"):
        df = pd.read_csv(filepath)
    else:
        df = pd.read_excel(filepath)

    # Get column names and their types
    columns = [
        {
            "name": col,
            "type": str(df[col].dtype),
            "sample": str(df[col].iloc[0]) if len(df) > 0 else "",
        }
        for col in df.columns
    ]

    return jsonify({"success": True, "columns": columns})


@app.route("/generate_synthetic", methods=["POST"])
def generate_synthetic():
    if "filepath" not in session:
        return jsonify({"error": "No data uploaded"})

    filepath = session["filepath"]

    # Read the original data
    if filepath.endswith(".csv"):
        original_df = pd.read_csv(filepath)
    else:
        original_df = pd.read_excel(filepath)

    # Get parameters from request
    method = request.json.get("method", "gaussian_copula")
    fields_to_mask = request.json.get("fields_to_mask", [])

    # Create metadata for the table
    metadata = SingleTableMetadata()
    metadata.detect_from_dataframe(original_df)

    # Mask selected fields in original data before training
    masked_df = original_df.copy()
    for field in fields_to_mask:
        if field in masked_df.columns:
            if pd.api.types.is_numeric_dtype(masked_df[field]):
                # For numeric fields, add random noise
                std = masked_df[field].std()
                masked_df[field] = masked_df[field] + np.random.normal(
                    0, std * 0.1, len(masked_df)
                )
            else:
                # For categorical/text fields, shuffle the values
                masked_df[field] = np.random.permutation(masked_df[field].values)

    # Generate synthetic data based on selected method
    if method == "gaussian_copula":
        model = GaussianCopulaSynthesizer(metadata)
    elif method == "ctgan":
        model = CTGANSynthesizer(metadata)
    elif method == "copulagan":
        model = CopulaGANSynthesizer(metadata)
    else:
        return jsonify({"error": "Invalid synthetic data generation method"})

    # Fit the model and generate synthetic data using masked data
    model.fit(masked_df)
    synthetic_df = model.sample(num_rows=len(original_df))

    # Save synthetic data
    synthetic_filename = f"synthetic_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    synthetic_filepath = os.path.join(app.config["UPLOAD_FOLDER"], synthetic_filename)
    synthetic_df.to_csv(synthetic_filepath, index=False)

    # Store synthetic filepath in session
    session["synthetic_filepath"] = synthetic_filepath

    # Run statistical analysis
    analysis_results = analyze_data_similarity(original_df, synthetic_df)

    # Generate visualizations
    visualizations = generate_visualizations(original_df, synthetic_df)

    return jsonify(
        {
            "success": True,
            "synthetic_preview": synthetic_df.head(5).to_dict(orient="records"),
            "analysis": analysis_results,
            "visualizations": visualizations,
        }
    )


def analyze_data_similarity(original_df, synthetic_df):
    """Perform statistical analysis to compare original and synthetic data"""
    results = {}

    # 1. Basic statistical comparison
    orig_stats = original_df.describe().to_dict()
    synth_stats = synthetic_df.describe().to_dict()

    # 2. Column-wise correlation analysis
    correlation_scores = {}
    for col in original_df.select_dtypes(include=[np.number]).columns:
        if col in synthetic_df.columns:
            try:
                corr, p_value = stats.pearsonr(
                    original_df[col].fillna(0), synthetic_df[col].fillna(0)
                )
                correlation_scores[col] = {"correlation": corr, "p_value": p_value}
            except:
                correlation_scores[col] = {"correlation": None, "p_value": None}

    # 3. SDV quality evaluation
    try:
        # Create metadata for evaluation
        metadata = SingleTableMetadata()
        metadata.detect_from_dataframe(original_df)

        quality_report = evaluate_quality(
            real_data=original_df, synthetic_data=synthetic_df, metadata=metadata
        )

        # Extract quality metrics in a way that works with newer SDV versions
        quality_scores = {
            "overall_quality": float(
                quality_report.get_score()
            ),  # Ensure it's a native Python type
            "properties": {},
        }

        # Get available properties from the report
        try:
            properties = quality_report.get_properties()
            for prop in properties:
                try:
                    prop_details = quality_report.get_details(prop)

                    # Convert any DataFrames or Series to dictionaries
                    if isinstance(prop_details, pd.DataFrame):
                        prop_details = prop_details.to_dict()
                    elif isinstance(prop_details, pd.Series):
                        prop_details = prop_details.to_dict()
                    elif isinstance(prop_details, dict):
                        # Check if any values in the dict are DataFrames or Series
                        for k, v in list(prop_details.items()):
                            if isinstance(v, (pd.DataFrame, pd.Series)):
                                prop_details[k] = v.to_dict()
                            elif not isinstance(
                                v, (int, float, str, bool, list, dict, type(None))
                            ):
                                # Convert any other non-JSON serializable objects to strings
                                prop_details[k] = str(v)

                    quality_scores["properties"][prop] = prop_details
                except Exception as detail_error:
                    quality_scores["properties"][prop] = {"error": str(detail_error)}
        except Exception as prop_error:
            quality_scores["properties_error"] = str(prop_error)

    except Exception as e:
        quality_scores = {"error": str(e)}

    # 4. Mutual information for categorical variables
    mutual_info = {}
    for col in original_df.select_dtypes(include=["object", "category"]).columns:
        if col in synthetic_df.columns:
            try:
                # Convert to categorical codes for MI calculation
                orig_cat = pd.Categorical(original_df[col]).codes
                synth_cat = pd.Categorical(synthetic_df[col]).codes

                mi = mutual_info_score(orig_cat, synth_cat)
                mutual_info[col] = float(mi)  # Ensure it's a native Python float
            except:
                mutual_info[col] = None

    results = {
        "original_stats": orig_stats,
        "synthetic_stats": synth_stats,
        "correlation_scores": correlation_scores,
        "quality_scores": quality_scores,
        "mutual_info": mutual_info,
    }

    return results


def generate_visualizations(original_df, synthetic_df):
    """Generate visualizations comparing original and synthetic data"""
    visualizations = {}

    # 1. Histograms for numerical columns
    for col in original_df.select_dtypes(include=[np.number]).columns[
        :5
    ]:  # Limit to first 5 columns
        if col in synthetic_df.columns:
            try:
                plt.figure(figsize=(10, 6))
                plt.hist(original_df[col], alpha=0.5, label="Original", bins=30)
                plt.hist(synthetic_df[col], alpha=0.5, label="Synthetic", bins=30)
                plt.legend()
                plt.title(f"Distribution of {col}")
                plt.xlabel(col)
                plt.ylabel("Frequency")

                # Save to base64
                buffer = io.BytesIO()
                plt.savefig(buffer, format="png")
                buffer.seek(0)
                image_png = buffer.getvalue()
                buffer.close()
                plt.close()

                visualizations[f"hist_{col}"] = base64.b64encode(image_png).decode(
                    "utf-8"
                )
            except Exception as e:
                visualizations[f"hist_{col}_error"] = str(e)

    # 2. PCA visualization for numerical data
    try:
        # Select numerical columns
        num_cols = original_df.select_dtypes(include=[np.number]).columns
        if len(num_cols) >= 2:
            # Prepare data
            orig_num = original_df[num_cols].fillna(0)
            synth_num = synthetic_df[num_cols].fillna(0)

            # Standardize
            scaler = StandardScaler()
            orig_scaled = scaler.fit_transform(orig_num)
            synth_scaled = scaler.transform(synth_num)

            # PCA
            pca = PCA(n_components=2)
            orig_pca = pca.fit_transform(orig_scaled)
            synth_pca = pca.transform(synth_scaled)

            # Plot
            plt.figure(figsize=(10, 8))
            plt.scatter(orig_pca[:, 0], orig_pca[:, 1], alpha=0.5, label="Original")
            plt.scatter(synth_pca[:, 0], synth_pca[:, 1], alpha=0.5, label="Synthetic")
            plt.legend()
            plt.title("PCA: Original vs Synthetic Data")
            plt.xlabel("Principal Component 1")
            plt.ylabel("Principal Component 2")

            # Save to base64
            buffer = io.BytesIO()
            plt.savefig(buffer, format="png")
            buffer.seek(0)
            image_png = buffer.getvalue()
            buffer.close()
            plt.close()

            visualizations["pca"] = base64.b64encode(image_png).decode("utf-8")
    except Exception as e:
        visualizations["pca_error"] = str(e)

    return visualizations


@app.route("/download_synthetic", methods=["GET"])
def download_synthetic():
    if "synthetic_filepath" not in session:
        return jsonify({"error": "No synthetic data available"})

    synthetic_filepath = session["synthetic_filepath"]

    # Read the synthetic data
    synthetic_df = pd.read_csv(synthetic_filepath)

    # Convert to JSON
    synthetic_json = synthetic_df.to_json(orient="records")

    return jsonify({"success": True, "data": json.loads(synthetic_json)})


if __name__ == "__main__":
    app.run(debug=True)
