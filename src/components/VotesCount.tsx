'use client';

import { User, Users, UsersThree } from '@phosphor-icons/react';

type VotesCountProps = {
  /** Positive votes for this model. */
  wins: number;
  /** Every model's positive-vote count; the icon scales within this field. */
  allWins: number[];
  size?: number;
};

/**
 * Vote tally with a people mark that fills out (1 → 3 people) as the count
 * grows. Tiers are cut across the field's min–max spread, since raw counts
 * cluster too tightly for a share-of-max rule to differentiate.
 */
export const VotesCount = ({ wins, allWins, size = 14 }: VotesCountProps) => {
  const min = Math.min(...allWins);
  const max = Math.max(...allWins);
  const ratio = max > min ? (wins - min) / (max - min) : 1;
  const Icon = ratio >= 2 / 3 ? UsersThree : ratio >= 1 / 3 ? Users : User;
  return (
    <span className="votes-count">
      <Icon size={size} weight="bold" aria-hidden="true" />
      {wins.toLocaleString()}
    </span>
  );
};
