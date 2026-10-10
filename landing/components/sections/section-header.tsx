import styles from "./section.module.css";

export function SectionHeader({ id, stage, title, intro }: { id: string; stage: string; title: string; intro?: string }) {
  return (
    <header className={styles.header}>
      <div className={styles.banner}>
        <span className={styles.cloud} aria-hidden="true" />
        <span className={`${styles.cloud} ${styles.cloudFar}`} aria-hidden="true" />
        <p className={styles.stage}>{stage}</p>
      </div>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
    </header>
  );
}
