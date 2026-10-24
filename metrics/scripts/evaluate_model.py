#!/usr/bin/env python3
"""
Mirage Scientific Gesture Recognition Evaluator
Computes rigorous machine learning metrics using scikit-learn from real evaluation predictions.
Outputs:
  - metrics/data/per_class_metrics.csv
  - metrics/data/confusion_matrix.csv
  - metrics/evaluation_summary.csv
"""

import os
import sys
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    precision_recall_fscore_support,
    confusion_matrix,
    classification_report,
)

def evaluate(predictions_path: str, data_dir: str, summary_path: str):
    if not os.path.exists(predictions_path):
        print(f"[Error] Prediction file not found: {predictions_path}", file=sys.stderr)
        sys.exit(1)

    df = pd.read_csv(predictions_path)
    total_samples = len(df)
    print(f"[Evaluator] Loaded {total_samples} evaluation samples from {predictions_path}")

    y_true = df["ground_truth"].astype(str)
    y_pred = df["predicted_label"].astype(str)

    # Sorted unique classes
    all_classes = sorted(list(set(y_true.unique()).union(set(y_pred.unique()))))

    # Global Accuracy
    acc = accuracy_score(y_true, y_pred)
    correct_count = int(df["is_correct"].sum())
    incorrect_count = total_samples - correct_count

    # Global macro and weighted metrics
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(
        y_true, y_pred, average="macro", zero_division=0
    )
    p_weighted, r_weighted, f1_weighted, _ = precision_recall_fscore_support(
        y_true, y_pred, average="weighted", zero_division=0
    )

    # Per-class metrics
    p_class, r_class, f1_class, support_class = precision_recall_fscore_support(
        y_true, y_pred, labels=all_classes, average=None, zero_division=0
    )

    # Confusion matrix
    cm = confusion_matrix(y_true, y_pred, labels=all_classes)
    cm_df = pd.DataFrame(cm, index=all_classes, columns=all_classes)
    cm_csv_path = os.path.join(data_dir, "confusion_matrix.csv")
    cm_df.to_csv(cm_csv_path)
    print(f"[Evaluator] Saved confusion matrix to {cm_csv_path}")

    # Build per-class DataFrame
    per_class_rows = []
    for idx, c in enumerate(all_classes):
        tp = cm[idx, idx]
        fp = cm[:, idx].sum() - tp
        fn = cm[idx, :].sum() - tp
        per_class_rows.append({
            "class_name": c,
            "support": int(support_class[idx]),
            "true_positives": int(tp),
            "false_positives": int(fp),
            "false_negatives": int(fn),
            "precision": float(p_class[idx]),
            "recall": float(r_class[idx]),
            "f1_score": float(f1_class[idx]),
        })

    per_class_df = pd.DataFrame(per_class_rows)
    per_class_csv_path = os.path.join(data_dir, "per_class_metrics.csv")
    per_class_df.to_csv(per_class_csv_path, index=False)
    print(f"[Evaluator] Saved per-class metrics to {per_class_csv_path}")

    # Timing metrics
    latencies = df["inference_time_ms"].values
    mean_latency = float(np.mean(latencies))
    median_latency = float(np.median(latencies))
    p95_latency = float(np.percentile(latencies, 95))
    min_latency = float(np.min(latencies))
    max_latency = float(np.max(latencies))

    # Unknown rejection rate (Specificity on UNKNOWN)
    unknown_mask = df["ground_truth"] == "UNKNOWN"
    if unknown_mask.sum() > 0:
        unknown_rejection_rate = float(
            (df[unknown_mask]["predicted_label"] == "UNKNOWN").mean()
        )
    else:
        unknown_rejection_rate = 0.0

    # Summary table
    summary_data = [
        {"metric": "Evaluated Samples", "value": f"{total_samples}"},
        {"metric": "Correct Predictions", "value": f"{correct_count}"},
        {"metric": "Incorrect Predictions", "value": f"{incorrect_count}"},
        {"metric": "Overall Accuracy", "value": f"{acc * 100:.2f}%"},
        {"metric": "Macro Precision", "value": f"{p_macro * 100:.2f}%"},
        {"metric": "Macro Recall", "value": f"{r_macro * 100:.2f}%"},
        {"metric": "Macro F1-Score", "value": f"{f1_macro * 100:.2f}%"},
        {"metric": "Weighted Precision", "value": f"{p_weighted * 100:.2f}%"},
        {"metric": "Weighted Recall", "value": f"{r_weighted * 100:.2f}%"},
        {"metric": "Weighted F1-Score", "value": f"{f1_weighted * 100:.2f}%"},
        {"metric": "Unknown Rejection Rate (Specificity)", "value": f"{unknown_rejection_rate * 100:.2f}%"},
        {"metric": "Mean FSM Inference Time", "value": f"{mean_latency:.3f} ms"},
        {"metric": "Median FSM Inference Time", "value": f"{median_latency:.3f} ms"},
        {"metric": "P95 FSM Inference Time", "value": f"{p95_latency:.3f} ms"},
        {"metric": "Min / Max FSM Inference Time", "value": f"{min_latency:.3f} ms / {max_latency:.3f} ms"},
    ]
    summary_df = pd.DataFrame(summary_data)
    summary_df.to_csv(summary_path, index=False)
    print(f"[Evaluator] Saved evaluation summary to {summary_path}")

    # Terminal report
    print("\n" + "=" * 60)
    print("           MIRAGE MODEL EVALUATION SUMMARY")
    print("=" * 60)
    for row in summary_data:
        print(f"  {row['metric']:<40} : {row['value']}")
    print("-" * 60)
    print(classification_report(y_true, y_pred, target_names=all_classes, zero_division=0))
    print("=" * 60 + "\n")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pred_path = os.path.join(base_dir, "data", "evaluation_predictions.csv")
    data_directory = os.path.join(base_dir, "data")
    summary_file = os.path.join(base_dir, "evaluation_summary.csv")
    evaluate(pred_path, data_directory, summary_file)
